import { createMapState, type PrivateEntry, type RollEntry, type RoomState } from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import { appendPrivate, canRollPrivately, mergeFeed } from '../src/state/feed.js';

const message = (id: string, at: number, text = 'hola'): RollEntry => ({
  kind: 'message',
  id,
  at,
  by: 'Alice',
  byId: 'p1',
  text,
});

const whisper = (id: string, at: number): PrivateEntry => ({ audience: ['p1'], entry: message(id, at) });

function room(overrides: Partial<RoomState> = {}): RoomState {
  return {
    id: 'c-1',
    gm: { id: 'gm-1', name: 'The GM', connected: true },
    players: [],
    characters: {},
    fear: 0,
    spotlight: null,
    countdowns: [],
    adversaryInstances: [],
    activeEnvironment: null,
    rest: null,
    consecutiveShortRests: 0,
    groupAction: null,
    tagTeam: null,
    spotlightTokens: null,
    adversaryPools: [],
    map: createMapState(),
    targets: {},
    journal: [],
    audio: { tracks: [], playing: null },
    tables: [],
    rollLog: [],
    privateLog: [],
    ...overrides,
  };
}

describe('mergeFeed', () => {
  it('interleaves the two logs newest first and marks the private ones', () => {
    const feed = mergeFeed([message('a', 30), message('b', 10)], [whisper('c', 20), whisper('d', 40)]);
    expect(feed.map((item) => [item.entry.id, item.private])).toEqual([
      ['d', true],
      ['a', false],
      ['c', true],
      ['b', false],
    ]);
  });

  it('shows an entry once even if both logs carry it', () => {
    const feed = mergeFeed([message('a', 10)], [whisper('a', 10)]);
    expect(feed).toHaveLength(1);
  });
});

describe('appendPrivate', () => {
  it('prepends new entries and ignores an id it already holds', () => {
    const before = room({ privateLog: [whisper('a', 10)] });
    const after = appendPrivate(before, [whisper('a', 10), whisper('b', 20)]);
    expect(after.privateLog.map((p) => p.entry.id)).toEqual(['b', 'a']);
    expect(before.privateLog).toHaveLength(1);
  });

  it('returns the same state when nothing is new', () => {
    const before = room({ privateLog: [whisper('a', 10)] });
    expect(appendPrivate(before, [whisper('a', 10)])).toBe(before);
  });
});

describe('canRollPrivately', () => {
  it('refuses a roll that is part of a Tag Team or a group action it does not lead', () => {
    expect(canRollPrivately(room(), 'pc1')).toBe(true);
    expect(
      canRollPrivately(room({ groupAction: { leadCharacterId: 'pc2', reactions: {} } }), 'pc1'),
    ).toBe(false);
    expect(
      canRollPrivately(room({ groupAction: { leadCharacterId: 'pc1', reactions: {} } }), 'pc1'),
    ).toBe(true);
    const tagTeam = { initiatorId: 'pc2', partnerId: 'pc1', rolls: {} };
    expect(canRollPrivately(room({ tagTeam }), 'pc1')).toBe(false);
    expect(canRollPrivately(room({ tagTeam }), 'pc3')).toBe(true);
  });
});
