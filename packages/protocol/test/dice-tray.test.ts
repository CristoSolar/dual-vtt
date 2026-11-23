import { scriptedRng, seededRng } from '@daggerheart/rules';
import { srd } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import {
  applyRoomEvent,
  createRoomState,
  createSheet,
  formatDiceTray,
  RoomEventSchema,
  RoomStateSchema,
  type Actor,
  type RollEntry,
  type RoomEvent,
  type RoomResult,
  type RoomState,
} from '../src/index.js';

import { makeCharacter } from './helpers.js';

/** The dice tray's loose dice, and the features and spells the log now records. */

const GM: Actor = { id: 'gm-1', role: 'gm' };
const ALEX: Actor = { id: 'acc-alex', role: 'player' };
const NOVA: Actor = { id: 'acc-nova', role: 'player' };
const NOW = 1_700_000_000_000;

/** Alex has a character; Nova is seated without one yet. */
function room(): RoomState {
  const base = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
  return {
    ...base,
    players: [
      { id: ALEX.id, name: 'Alex', connected: true, characterId: ALEX.id },
      { id: NOVA.id, name: 'Nova', connected: true, characterId: null },
    ],
    characters: { [ALEX.id]: createSheet(makeCharacter()) },
  };
}

function accepted(result: RoomResult): Extract<RoomResult, { ok: true }> {
  if (!result.ok) throw new Error(`rejected: ${result.error} ${result.message}`);
  return result;
}

const parse = (event: unknown): RoomEvent => RoomEventSchema.parse(event);

describe('rolling loose dice from the tray', () => {
  it('rolls every die on the server and totals them with the modifier', () => {
    // 2d6 showing 3 and 5, then a d20 showing 17; the last draw only names the entry.
    const rng = scriptedRng([[3, 6], [5, 6], [17, 20], 1]);
    const event = parse({
      type: 'rollDice',
      dice: [
        { sides: 6, count: 2 },
        { sides: 20, count: 1 },
      ],
      modifier: 1,
    });
    const r = accepted(applyRoomEvent(room(), ALEX, event, rng, NOW));
    const entry = r.state.rollLog[0];
    expect(entry).toMatchObject({
      kind: 'dice',
      by: 'Alex',
      byId: ALEX.id,
      label: '2d6+1d20+1',
      groups: [
        { sides: 6, rolls: [3, 5] },
        { sides: 20, rolls: [17] },
      ],
      modifier: 1,
      total: 26,
    });
    expect(r.entries).toEqual([entry]);
  });

  it('rolls a d100 as one number from 1 to 100', () => {
    const r = accepted(
      applyRoomEvent(
        room(),
        GM,
        parse({ type: 'rollDice', dice: [{ sides: 100, count: 1 }] }),
        scriptedRng([[42, 100], 1]),
        NOW,
      ),
    );
    expect(r.state.rollLog[0]).toMatchObject({ kind: 'dice', groups: [{ sides: 100, rolls: [42] }], total: 42 });
  });

  it('keeps a label the roller gave', () => {
    const r = accepted(
      applyRoomEvent(
        room(),
        GM,
        parse({ type: 'rollDice', dice: [{ sides: 20, count: 1 }], label: 'Perception' }),
        seededRng(1),
        NOW,
      ),
    );
    expect(r.state.rollLog[0]).toMatchObject({ label: 'Perception', by: 'GM', byId: GM.id });
  });

  it('lets a player who has no character yet roll', () => {
    const r = accepted(
      applyRoomEvent(room(), NOVA, parse({ type: 'rollDice', dice: [{ sides: 4, count: 3 }] }), seededRng(2), NOW),
    );
    expect(r.state.rollLog[0]).toMatchObject({ kind: 'dice', by: 'Nova', byId: NOVA.id });
  });

  it("routes a player's private roll to them and the GM", () => {
    const r = accepted(
      applyRoomEvent(
        room(),
        ALEX,
        parse({ type: 'rollDice', dice: [{ sides: 8, count: 1 }], visibility: 'private' }),
        seededRng(3),
        NOW,
      ),
    );
    expect(r.state.rollLog).toEqual([]);
    expect(r.entries).toEqual([]);
    expect(r.privateEntries[0]?.audience).toEqual([ALEX.id]);
    expect(r.privateEntries[0]?.entry.kind).toBe('dice');
  });

  it("keeps the GM's private roll to the GM alone", () => {
    const r = accepted(
      applyRoomEvent(
        room(),
        GM,
        parse({ type: 'rollDice', dice: [{ sides: 20, count: 1 }], visibility: 'private' }),
        seededRng(4),
        NOW,
      ),
    );
    expect(r.state.privateLog[0]?.audience).toEqual([]);
  });

  it('refuses dice the tray does not have, and more than it can hold', () => {
    const bad = [
      { type: 'rollDice', dice: [] },
      { type: 'rollDice', dice: [{ sides: 7, count: 1 }] },
      { type: 'rollDice', dice: [{ sides: 6, count: 0 }] },
      { type: 'rollDice', dice: [{ sides: 6, count: 21 }] },
      { type: 'rollDice', dice: Array.from({ length: 8 }, () => ({ sides: 6, count: 1 })) },
      { type: 'rollDice', dice: [{ sides: 6, count: 1 }], modifier: 100 },
      { type: 'rollDice', dice: [{ sides: 6, count: 1 }], label: 'x'.repeat(61) },
    ];
    for (const event of bad) expect(RoomEventSchema.safeParse(event).success, JSON.stringify(event)).toBe(false);
  });

  it('writes a tray roll out the way it reads', () => {
    expect(formatDiceTray([{ sides: 6, count: 2 }], 0)).toBe('2d6');
    expect(formatDiceTray([{ sides: 100, count: 1 }, { sides: 4, count: 1 }], -2)).toBe('1d100+1d4-2');
  });
});

describe('features and spells in the log', () => {
  const funded = (state: RoomState): RoomState => {
    const r = accepted(
      applyRoomEvent(state, ALEX, { type: 'gainHope', characterId: ALEX.id, amount: 3 }, seededRng(1), NOW),
    );
    return r.state;
  };

  it("logs a class Hope feature by its class, for every client to read in its own language", () => {
    const state = funded(room());
    const classId = state.characters[ALEX.id]?.character.classId;
    const feature = srd().classes.find((c) => c.id === classId)?.hopeFeature;
    const r = accepted(
      applyRoomEvent(state, ALEX, { type: 'useHopeFeature', characterId: ALEX.id }, seededRng(1), NOW),
    );
    expect(r.state.rollLog[0]).toMatchObject({
      kind: 'effect',
      source: 'hopeFeature',
      ref: classId,
      feature: null,
      title: feature?.name,
      by: 'Alex',
      byId: ALEX.id,
    });
    expect(r.entries).toHaveLength(1);
  });

  it('logs a domain card from the loadout when it is used', () => {
    // A card with nothing to pay, so only the log changes.
    const cardId = 'fortified-armor';
    const base = room();
    const sheet = base.characters[ALEX.id];
    if (sheet === undefined) throw new Error('no sheet');
    const state = { ...base, characters: { [ALEX.id]: { ...sheet, loadout: [cardId] } } };
    const card = srd().domainCards.find((c) => c.id === cardId);
    const r = accepted(
      applyRoomEvent(state, ALEX, { type: 'useDomainCard', characterId: ALEX.id, cardId }, seededRng(1), NOW),
    );
    expect(r.state.rollLog[0]).toMatchObject({ kind: 'effect', source: 'domainCard', ref: cardId, title: card?.name });
    // Using a card changes nothing on the sheet.
    expect(r.state.characters).toBe(state.characters);
  });

  it('refuses a card that is not in the loadout, or somebody else’s', () => {
    const state = room();
    const r = applyRoomEvent(
      state,
      ALEX,
      { type: 'useDomainCard', characterId: ALEX.id, cardId: 'not-a-card' },
      seededRng(1),
      NOW,
    );
    expect(r.ok).toBe(false);
    const cardId = state.characters[ALEX.id]?.loadout[0] ?? '';
    const other = applyRoomEvent(
      state,
      NOVA,
      { type: 'useDomainCard', characterId: ALEX.id, cardId },
      seededRng(1),
      NOW,
    );
    expect(other.ok ? null : other.error).toBe('notYourCharacter');
  });

  it("logs an adversary's feature under its name, publicly or for the GM alone", () => {
    const block = srd().adversaries[0];
    if (block === undefined) throw new Error('no adversaries');
    const feature = block.features.findIndex((f) => !f.costsFear && f.type !== 'evolution');
    const featureName = block.features[feature]?.name ?? '';
    const withAdversary = accepted(
      applyRoomEvent(
        room(),
        GM,
        parse({ type: 'addAdversary', instanceId: 'adv-1', adversaryId: block.id, name: 'Grunt 1' }),
        seededRng(1),
        NOW,
      ),
    ).state;
    const instance = withAdversary.adversaryInstances[0];
    if (instance === undefined) throw new Error('no instance');

    const shown = accepted(
      applyRoomEvent(
        withAdversary,
        GM,
        parse({ type: 'useAdversaryFeature', instanceId: instance.instanceId, featureName }),
        seededRng(1),
        NOW,
      ),
    );
    expect(shown.state.rollLog[0]).toMatchObject({
      kind: 'effect',
      source: 'adversaryFeature',
      ref: block.id,
      feature,
      title: featureName,
      by: instance.name,
      byId: GM.id,
    });

    const hidden = accepted(
      applyRoomEvent(
        withAdversary,
        GM,
        parse({ type: 'useAdversaryFeature', instanceId: instance.instanceId, featureName, visibility: 'private' }),
        seededRng(1),
        NOW,
      ),
    );
    expect(hidden.state.rollLog).toEqual([]);
    expect(hidden.privateEntries[0]?.audience).toEqual([]);
  });

  it("logs the active environment's feature", () => {
    const environment = srd().environments[0];
    if (environment === undefined) throw new Error('no environments');
    const featureName = environment.features[0]?.name ?? '';
    const state = { ...room(), activeEnvironment: environment.id };
    const r = accepted(
      applyRoomEvent(state, GM, parse({ type: 'useEnvironmentFeature', featureName }), seededRng(1), NOW),
    );
    expect(r.state.rollLog[0]).toMatchObject({
      kind: 'effect',
      source: 'environmentFeature',
      ref: environment.id,
      feature: 0,
      title: featureName,
      by: environment.name,
    });
  });

  it('gives two identical domain card uses at the same instant different ids', () => {
    const state = room();
    const cardId = state.characters[ALEX.id]?.loadout[0] ?? '';
    const event: RoomEvent = { type: 'useDomainCard', characterId: ALEX.id, cardId };
    const first = accepted(applyRoomEvent(state, ALEX, event, seededRng(1), NOW));
    const second = accepted(applyRoomEvent(first.state, ALEX, event, seededRng(1), NOW));
    const firstId = first.state.rollLog[0]?.id;
    const secondId = second.state.rollLog[0]?.id;
    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    expect(secondId).not.toBe(firstId);
  });

  it('still loads a snapshot, and one holding the new kinds', () => {
    const dice: RollEntry = {
      kind: 'dice',
      id: 'd1',
      at: NOW,
      by: 'GM',
      byId: GM.id,
      label: '1d20',
      groups: [{ sides: 20, rolls: [7] }],
      modifier: 0,
      total: 7,
    };
    const effect: RollEntry = {
      kind: 'effect',
      id: 'e1',
      at: NOW,
      by: 'Alex',
      byId: ALEX.id,
      source: 'domainCard',
      ref: 'some-card',
      feature: null,
      title: 'Some Card',
    };
    const saved = JSON.parse(JSON.stringify({ ...room(), rollLog: [dice, effect] }));
    expect(RoomStateSchema.parse(saved).rollLog).toEqual([dice, effect]);
    expect(RoomStateSchema.parse(JSON.parse(JSON.stringify(room()))).rollLog).toEqual([]);
  });
});
