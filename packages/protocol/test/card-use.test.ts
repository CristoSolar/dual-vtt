import { scriptedRng, seededRng } from '@daggerheart/rules';
import { srd, type ClassId } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import {
  applyRoomEvent,
  createRoomState,
  createSheet,
  RoomEventSchema,
  spellcastTraitOf,
  type Actor,
  type RoomEvent,
  type RoomResult,
  type RoomState,
  type SheetState,
} from '../src/index.js';

import { makeCharacter } from './helpers.js';

/** Using a domain card: its printed cost is paid on the server, then it is logged. */

const GM: Actor = { id: 'gm-1', role: 'gm' };
const ALEX: Actor = { id: 'acc-alex', role: 'player' };
const NOW = 1_700_000_000_000;

/** Alex holds exactly these cards, with the sheet adjusted as given. */
function room(
  loadout: string[],
  adjust: (sheet: SheetState) => SheetState = (s) => s,
  classId: ClassId = 'guardian',
): RoomState {
  const base = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
  const sheet = adjust({ ...createSheet(makeCharacter(classId)), loadout });
  return {
    ...base,
    players: [{ id: ALEX.id, name: 'Alex', connected: true, characterId: ALEX.id }],
    characters: { [ALEX.id]: sheet },
  };
}

function accepted(result: RoomResult): Extract<RoomResult, { ok: true }> {
  if (!result.ok) throw new Error(`rejected: ${result.error} ${result.message}`);
  return result;
}

function sheetOf(state: RoomState): SheetState {
  const sheet = state.characters[ALEX.id];
  if (sheet === undefined) throw new Error('no sheet');
  return sheet;
}

const use = (cardId: string, extra: { ability?: number; onSuccess?: boolean } = {}): RoomEvent => ({
  type: 'useDomainCard',
  characterId: ALEX.id,
  cardId,
  ...extra,
});

const apply = (state: RoomState, event: RoomEvent) => applyRoomEvent(state, ALEX, event, seededRng(1), NOW);

describe('paying a card’s cost', () => {
  it('marks the Stress a "Mark a Stress to…" card costs, and logs the use', () => {
    // Reckless: "Mark a Stress to gain advantage on an attack."
    const state = room(['reckless']);
    const r = accepted(apply(state, use('reckless')));
    expect(sheetOf(r.state).stressMarked).toBe(sheetOf(state).stressMarked + 1);
    expect(r.state.rollLog[0]).toMatchObject({ kind: 'effect', source: 'domainCard', ref: 'reckless' });
  });

  it('marks a Hit Point instead when every Stress slot is already marked', () => {
    const state = room(['reckless'], (s) => ({ ...s, stressMarked: s.character.stressSlots }));
    const r = accepted(apply(state, use('reckless')));
    const after = sheetOf(r.state);
    expect(after.stressMarked).toBe(after.character.stressSlots);
    expect(after.hpMarked).toBe(sheetOf(state).hpMarked + 1);
    expect(r.effect?.stressBecameHP).toBe(true);
  });

  it('marks several Stress at once, overflowing the rest into a Hit Point', () => {
    // Chains of Affliction: "Mark 2 Stress to temporarily Chain a target…"
    const state = room(['chains-of-affliction'], (s) => ({ ...s, stressMarked: s.character.stressSlots - 1 }));
    const r = accepted(apply(state, use('chains-of-affliction')));
    const after = sheetOf(r.state);
    expect(after.stressMarked).toBe(after.character.stressSlots);
    expect(after.hpMarked).toBe(1);
  });

  it('spends the Hope a "Spend a Hope to…" card costs', () => {
    const state = room(['wall-walk'], (s) => ({ ...s, hope: 2 }));
    const r = accepted(apply(state, use('wall-walk')));
    expect(sheetOf(r.state).hope).toBe(1);
  });

  it('refuses a Hope cost the character cannot pay, changing nothing', () => {
    const state = room(['wall-walk'], (s) => ({ ...s, hope: 0 }));
    const r = apply(state, use('wall-walk'));
    expect(r.ok ? null : r.error).toBe('notEnoughHope');
  });

  it('charges nothing for a card with no cost', () => {
    const state = room(['fortified-armor']);
    const r = accepted(apply(state, use('fortified-armor')));
    expect(r.state.characters).toBe(state.characters);
    expect(r.state.rollLog).toHaveLength(1);
  });

  it('still refuses a card that is not in the loadout', () => {
    const r = apply(room(['reckless']), use('wall-walk'));
    expect(r.ok ? null : r.error).toBe('rejected');
  });
});

describe('a grimoire’s spells', () => {
  it('pays and logs the spell chosen, named in the entry', () => {
    // Book of Ava: Power Push, Tava's Armor (Spend a Hope), Ice Spike.
    const state = room(['book-of-ava'], (s) => ({ ...s, hope: 1 }));
    const r = accepted(apply(state, use('book-of-ava', { ability: 1 })));
    expect(sheetOf(r.state).hope).toBe(0);
    const card = srd().domainCards.find((c) => c.id === 'book-of-ava');
    const spell = srd().cardMechanics.find((m) => m.id === 'book-of-ava')?.abilities[1]?.name;
    expect(r.state.rollLog[0]).toMatchObject({
      kind: 'effect',
      ref: 'book-of-ava',
      feature: 1,
      title: `${card?.name ?? ''} — ${spell ?? ''}`,
    });
  });

  it('takes an intent without an ability, from an older client, as the first spell', () => {
    const state = room(['book-of-ava'], (s) => ({ ...s, hope: 1 }));
    const event = RoomEventSchema.parse({ type: 'useDomainCard', characterId: ALEX.id, cardId: 'book-of-ava' });
    const r = accepted(apply(state, event));
    // Power Push costs nothing; Tava's Armor would have cost the Hope.
    expect(sheetOf(r.state).hope).toBe(1);
    expect(r.state.rollLog[0]).toMatchObject({ feature: 0 });
  });

  it('refuses a spell the card does not have', () => {
    const r = apply(room(['book-of-tyfar']), use('book-of-tyfar', { ability: 3 }));
    expect(r.ok ? null : r.error).toBe('unknownAbility');
    // A single-ability card has only the first.
    const single = apply(room(['reckless']), use('reckless', { ability: 1 }));
    expect(single.ok ? null : single.error).toBe('unknownAbility');
  });

  it('bounds the ability index on the wire', () => {
    expect(RoomEventSchema.safeParse({ ...use('book-of-tyfar'), ability: 10 }).success).toBe(false);
    expect(RoomEventSchema.safeParse({ ...use('book-of-tyfar'), ability: -1 }).success).toBe(false);
  });
});

describe('a cost paid on a success', () => {
  it('costs nothing to cast, and its Hope once the roll has landed', () => {
    // Bolt Beacon: "On a success, spend a Hope to send a bolt of shimmering light…"
    const state = room(['bolt-beacon'], (s) => ({ ...s, hope: 1 }));
    const cast = accepted(apply(state, use('bolt-beacon')));
    expect(sheetOf(cast.state).hope).toBe(1);
    const paid = accepted(apply(cast.state, use('bolt-beacon', { onSuccess: true })));
    expect(sheetOf(paid.state).hope).toBe(0);
    // Paying is not a second use: nothing more is logged.
    expect(paid.state.rollLog).toHaveLength(1);
  });

  it('refuses an on-success cost the character cannot pay', () => {
    const r = apply(room(['bolt-beacon'], (s) => ({ ...s, hope: 0 })), use('bolt-beacon', { onSuccess: true }));
    expect(r.ok ? null : r.error).toBe('notEnoughHope');
  });

  it('refuses to pay an on-success cost an ability does not have', () => {
    const r = apply(room(['reckless']), use('reckless', { onSuccess: true }));
    expect(r.ok ? null : r.error).toBe('rejected');
  });
});

describe('card damage', () => {
  const damage = (state: RoomState, scale: 'proficiency' | 'spellcast' | 'none' | undefined, rng = scriptedRng([[1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 6]])) =>
    accepted(
      applyRoomEvent(
        state,
        ALEX,
        {
          type: 'rollDamage',
          characterId: ALEX.id,
          label: 'Wild Flame',
          dice: { count: 2, die: 6 },
          modifier: 0,
          critical: false,
          visibility: 'public',
          ...(scale === undefined ? {} : { scale }),
        },
        rng,
        NOW,
      ),
    ).state.rollLog[0];

  it('rolls fixed dice as printed, without Proficiency', () => {
    const state = room([], (s) => ({ ...s, character: { ...s.character, proficiency: 3 } }));
    const entry = damage(state, 'none');
    expect(entry?.kind === 'damage' ? entry.roll.rolls : null).toEqual([1, 2]);
  });

  it('multiplies by Proficiency by default, as a weapon does', () => {
    const state = room([], (s) => ({ ...s, character: { ...s.character, proficiency: 2 } }));
    const entry = damage(state, undefined);
    expect(entry?.kind === 'damage' ? entry.roll.rolls : null).toHaveLength(4);
  });

  it('multiplies by the Spellcast trait for "using your Spellcast trait"', () => {
    const base = room([], (s) => s, 'wizard');
    const trait = spellcastTraitOf(sheetOf(base));
    if (trait === null) throw new Error('a wizard has a Spellcast trait');
    const state = room(
      [],
      (s) => ({ ...s, character: { ...s.character, traits: { ...s.character.traits, [trait]: 3 } } }),
      'wizard',
    );
    const entry = damage(state, 'spellcast');
    expect(entry?.kind === 'damage' ? entry.roll.rolls : null).toHaveLength(6);
  });
});
