import { seededRng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import {
  applyRoomEvent,
  CampaignPrepEventSchema,
  createRoomState,
  roomForRole,
  roomPatch,
  RoomStateSchema,
  type Actor,
  type PrepAdversary,
  type RoomEvent,
  type RoomState,
} from '../src/index.js';

/**
 * The GM's preparation: the campaign's story and the adversaries planned for it.
 * Both are GM-only slices, like the random tables: a player never receives them.
 */

const GM: Actor = { id: 'gm-1', role: 'gm' };
const ALEX: Actor = { id: 'acc-alex', role: 'player' };
const NOW = 1_700_000_000_000;

function apply(state: RoomState, actor: Actor, event: RoomEvent): RoomState {
  const result = applyRoomEvent(state, actor, event, seededRng(1), NOW);
  if (!result.ok) throw new Error(`rejected: ${result.error} ${result.message}`);
  return result.state;
}

function refusal(state: RoomState, actor: Actor, event: RoomEvent): string {
  const result = applyRoomEvent(state, actor, event, seededRng(1), NOW);
  if (result.ok) throw new Error('expected a refusal, got a new state');
  return result.error;
}

const prep = (id: string, adversaryId = 'acid-burrower', quantity = 1): PrepAdversary => ({
  id,
  adversaryId,
  quantity,
  note: '',
});

function preparedRoom(): RoomState {
  let room = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
  room = { ...room, players: [{ id: ALEX.id, name: 'Alex', connected: true, characterId: null }] };
  room = apply(room, GM, { type: 'setStory', story: { pitch: 'A heist.', body: 'Session 1: the vault.' } });
  room = apply(room, GM, { type: 'upsertPrepAdversary', entry: prep('p-1', 'acid-burrower', 2) });
  return room;
}

describe('prep intents', () => {
  it('are GM-only', () => {
    const room = preparedRoom();
    const events: RoomEvent[] = [
      { type: 'setStory', story: { pitch: 'x', body: 'y' } },
      { type: 'upsertPrepAdversary', entry: prep('p-2') },
      { type: 'removePrepAdversary', id: 'p-1' },
    ];
    for (const event of events) expect(refusal(room, ALEX, event)).toBe('notGameMaster');
  });

  it('setStory replaces the story', () => {
    const room = apply(preparedRoom(), GM, { type: 'setStory', story: { pitch: 'P', body: 'B' } });
    expect(room.story).toEqual({ pitch: 'P', body: 'B' });
  });

  it('upsert adds a new entry and replaces an existing one in place', () => {
    let room = apply(preparedRoom(), GM, { type: 'upsertPrepAdversary', entry: prep('p-2', 'ahuizotl') });
    expect(room.prepAdversaries.map((p) => p.id)).toEqual(['p-1', 'p-2']);
    room = apply(room, GM, {
      type: 'upsertPrepAdversary',
      entry: { ...prep('p-1', 'acid-burrower', 5), note: 'in the sewers' },
    });
    expect(room.prepAdversaries.map((p) => p.id)).toEqual(['p-1', 'p-2']);
    expect(room.prepAdversaries[0]).toMatchObject({ quantity: 5, note: 'in the sewers' });
  });

  it('refuses an adversary the SRD does not have', () => {
    expect(refusal(preparedRoom(), GM, { type: 'upsertPrepAdversary', entry: prep('p-9', 'no-such') })).toBe(
      'unknownAdversary',
    );
  });

  it('remove drops the entry, and refuses an unknown id', () => {
    const room = apply(preparedRoom(), GM, { type: 'removePrepAdversary', id: 'p-1' });
    expect(room.prepAdversaries).toEqual([]);
    expect(refusal(room, GM, { type: 'removePrepAdversary', id: 'p-1' })).toBe('unknownPrepAdversary');
  });

  it('does not touch the encounter: preparing is not fielding', () => {
    expect(preparedRoom().adversaryInstances).toEqual([]);
  });
});

describe('what a player receives', () => {
  it('neither the story nor the prep list', () => {
    const forPlayer = roomForRole(preparedRoom(), 'player');
    expect(forPlayer.story).toEqual({ pitch: '', body: '' });
    expect(forPlayer.prepAdversaries).toEqual([]);
  });

  it('keeps the same empty references, so an unrelated change is not a prep patch', () => {
    const before = preparedRoom();
    const after = apply(before, GM, { type: 'gainFear', amount: 1 });
    expect(roomForRole(before, 'player').story).toBe(roomForRole(after, 'player').story);
    expect(roomForRole(before, 'player').prepAdversaries).toBe(roomForRole(after, 'player').prepAdversaries);
  });

  it('player patch is empty when only the prep changed', () => {
    const before = preparedRoom();
    let after = apply(before, GM, { type: 'upsertPrepAdversary', entry: prep('p-2', 'ahuizotl') });
    after = apply(after, GM, { type: 'setStory', story: { pitch: 'new', body: 'new' } });
    expect(roomPatch(roomForRole(before, 'player'), roomForRole(after, 'player'))).toEqual({});
  });

  it('the GM patch carries both slices', () => {
    const before = preparedRoom();
    let after = apply(before, GM, { type: 'upsertPrepAdversary', entry: prep('p-2', 'ahuizotl') });
    after = apply(after, GM, { type: 'setStory', story: { pitch: 'new', body: 'new' } });
    const patch = roomPatch(before, after);
    expect(patch.prepAdversaries?.map((p) => p.id)).toEqual(['p-1', 'p-2']);
    expect(patch.story?.pitch).toBe('new');
  });
});

describe('old snapshots', () => {
  it('load without story or prep', () => {
    const { story: _s, prepAdversaries: _p, ...old } = preparedRoom();
    const parsed = RoomStateSchema.parse(old);
    expect(parsed.story).toEqual({ pitch: '', body: '' });
    expect(parsed.prepAdversaries).toEqual([]);
  });
});

describe('CampaignPrepEventSchema', () => {
  it('admits only the intents the campaign page sends', () => {
    expect(CampaignPrepEventSchema.safeParse({ type: 'setStory', story: { pitch: '', body: '' } }).success).toBe(true);
    expect(CampaignPrepEventSchema.safeParse({ type: 'removePrepAdversary', id: 'p-1' }).success).toBe(true);
    expect(
      CampaignPrepEventSchema.safeParse({
        type: 'upsertJournalEntry',
        entry: { id: 'j-1', title: 'T', body: '', image: null, shared: 'gm' },
      }).success,
    ).toBe(true);
    expect(CampaignPrepEventSchema.safeParse({ type: 'removeJournalEntry', id: 'j-1' }).success).toBe(true);
    expect(CampaignPrepEventSchema.safeParse({ type: 'gainFear', amount: 1 }).success).toBe(false);
    expect(
      CampaignPrepEventSchema.safeParse({ type: 'addAdversary', instanceId: 'a', adversaryId: 'b', name: 'c' }).success,
    ).toBe(false);
  });

  it('caps the story and the quantity', () => {
    expect(
      CampaignPrepEventSchema.safeParse({ type: 'setStory', story: { pitch: 'x'.repeat(501), body: '' } }).success,
    ).toBe(false);
    expect(
      CampaignPrepEventSchema.safeParse({ type: 'upsertPrepAdversary', entry: { ...prep('p'), quantity: 0 } }).success,
    ).toBe(false);
  });
});
