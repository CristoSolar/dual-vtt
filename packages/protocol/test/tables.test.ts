import { seededRng, type Rng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import {
  applyRoomEvent,
  createRoomState,
  roomForRole,
  roomPatch,
  RoomStateSchema,
  type Actor,
  type RollTable,
  type RoomEvent,
  type RoomState,
} from '../src/index.js';

/**
 * The GM's random tables: a name and rows, rolled uniformly at random on the
 * server. They are GM-only, same as the journal's unshared pages, but with no
 * shared variant at all — a player never sees one.
 */

const GM: Actor = { id: 'gm-1', role: 'gm' };
const ALEX: Actor = { id: 'acc-alex', role: 'player' };

const NOW = 1_700_000_000_000;

function apply(state: RoomState, actor: Actor, event: RoomEvent, rng: Rng): RoomState {
  const result = applyRoomEvent(state, actor, event, rng, NOW);
  if (!result.ok) throw new Error(`rejected: ${result.error} ${result.message}`);
  return result.state;
}

function refusal(state: RoomState, actor: Actor, event: RoomEvent, rng: Rng): string {
  const result = applyRoomEvent(state, actor, event, rng, NOW);
  if (result.ok) throw new Error('expected a refusal, got a new state');
  return result.error;
}

const table = (id: string, rows: string[] = ['A', 'B', 'C']): RollTable => ({
  id,
  name: `Table ${id}`,
  rows,
});

function roomWithTable(): RoomState {
  let room = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
  room = {
    ...room,
    players: [{ id: ALEX.id, name: 'Alex', connected: true, characterId: null }],
  };
  room = apply(room, GM, { type: 'upsertTable', table: table('t-1') }, seededRng(1));
  return room;
}

describe('table intents', () => {
  it('are GM-only', () => {
    const room = roomWithTable();
    const rng = seededRng(1);
    const events: RoomEvent[] = [
      { type: 'upsertTable', table: table('t-x') },
      { type: 'removeTable', id: 't-1' },
      { type: 'rollTable', tableId: 't-1', visibility: 'public' },
    ];
    for (const event of events) expect(refusal(room, ALEX, event, rng)).toBe('notGameMaster');
  });

  it('upserting an existing id replaces that table in place', () => {
    const room = apply(
      roomWithTable(),
      GM,
      { type: 'upsertTable', table: table('t-1', ['X', 'Y']) },
      seededRng(1),
    );
    expect(room.tables).toHaveLength(1);
    expect(room.tables[0]?.rows).toEqual(['X', 'Y']);
  });

  it('removes a table, and refuses an unknown one', () => {
    const removed = apply(roomWithTable(), GM, { type: 'removeTable', id: 't-1' }, seededRng(1));
    expect(removed.tables).toEqual([]);
    expect(refusal(roomWithTable(), GM, { type: 'removeTable', id: 'nope' }, seededRng(1))).toBe(
      'unknownTable',
    );
  });

  it('refuses rolling an unknown table', () => {
    expect(
      refusal(
        roomWithTable(),
        GM,
        { type: 'rollTable', tableId: 'nope', visibility: 'public' },
        seededRng(1),
      ),
    ).toBe('unknownTable');
  });

  it('with a seeded rng, the chosen row is stable', () => {
    const room = roomWithTable();
    const r1 = applyRoomEvent(
      room,
      GM,
      { type: 'rollTable', tableId: 't-1', visibility: 'public' },
      seededRng(1),
      NOW,
    );
    const r2 = applyRoomEvent(
      room,
      GM,
      { type: 'rollTable', tableId: 't-1', visibility: 'public' },
      seededRng(1),
      NOW,
    );
    if (!r1.ok || !r2.ok) throw new Error('roll was rejected');
    const e1 = r1.state.rollLog[0];
    const e2 = r2.state.rollLog[0];
    if (e1 === undefined || e1.kind !== 'table' || e2 === undefined || e2.kind !== 'table') {
      throw new Error('no table entry logged');
    }
    expect(e1.index).toBe(e2.index);
    expect(e1.result).toBe(e2.result);
    expect(e1.label).toBe('Table t-1');
  });

  it('routes a private roll to the private log, GM-only audience', () => {
    const room = roomWithTable();
    const r = applyRoomEvent(
      room,
      GM,
      { type: 'rollTable', tableId: 't-1', visibility: 'private' },
      seededRng(1),
      NOW,
    );
    if (!r.ok) throw new Error('roll was rejected');
    expect(r.state.rollLog).toHaveLength(0);
    expect(r.entries).toHaveLength(0);
    expect(r.privateEntries[0]?.audience).toEqual([]);
    expect(r.state.privateLog[0]?.entry.kind).toBe('table');
  });

  it('a public roll goes to the shared log', () => {
    const room = roomWithTable();
    const r = applyRoomEvent(
      room,
      GM,
      { type: 'rollTable', tableId: 't-1', visibility: 'public' },
      seededRng(1),
      NOW,
    );
    if (!r.ok) throw new Error('roll was rejected');
    expect(r.state.rollLog).toHaveLength(1);
    expect(r.entries).toHaveLength(1);
    expect(r.privateEntries).toEqual([]);
  });
});

describe('what a player receives', () => {
  it('never sees the tables slice', () => {
    const forPlayer = roomForRole(roomWithTable(), 'player');
    expect(forPlayer.tables).toEqual([]);
  });

  it('keeps the same (empty) reference across calls, so an unrelated change is not a tables patch', () => {
    let room = roomWithTable();
    room = apply(room, GM, { type: 'gainFear', amount: 1 }, seededRng(1));
    const before = roomWithTable();
    expect(roomForRole(before, 'player').tables).toBe(roomForRole(room, 'player').tables);
  });

  it('player patch has no tables entry when only a table changed', () => {
    const before = roomWithTable();
    const after = apply(before, GM, { type: 'upsertTable', table: table('t-2') }, seededRng(1));
    const patch = roomPatch(roomForRole(before, 'player'), roomForRole(after, 'player'));
    expect(patch).not.toHaveProperty('tables');
  });

  it('the tables slice travels in the GM patch', () => {
    const before = roomWithTable();
    const after = apply(before, GM, { type: 'upsertTable', table: table('t-2') }, seededRng(1));
    expect(roomPatch(before, after).tables?.map((t) => t.id)).toEqual(['t-1', 't-2']);
  });
});

describe('old snapshots', () => {
  it('load without a tables slice', () => {
    const { tables: _dropped, ...old } = roomWithTable();
    const parsed = RoomStateSchema.parse(old);
    expect(parsed.tables).toEqual([]);
  });
});
