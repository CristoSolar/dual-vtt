import {
  createMapState,
  createScene,
  type RollEntry,
  type RoomState,
  type Token,
} from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import { GM_COLOR, colorFor } from '../src/state/playerColor.js';
import {
  adversaryTargetOf,
  firstTarget,
  newestDamageIds,
  pcTargetOf,
  targetRings,
  toggleTarget,
} from '../src/state/targets.js';

const token = (id: string, over: Partial<Token> = {}): Token => ({
  id,
  kind: 'marker',
  refId: null,
  name: id,
  x: 0,
  y: 0,
  width: 50,
  height: 50,
  rotation: 0,
  color: '#fff',
  image: null,
  colorFrame: false,
  hidden: false,
  showRings: false,
  ownerId: null,
  conditions: [],
  dragFrom: null,
  visionRadius: 300,
  ...over,
});

function room(targets: RoomState['targets']): RoomState {
  const scene = {
    ...createScene('s-1', 'Bridge'),
    tokens: [
      token('marker'),
      token('wolf', { kind: 'adversary', refId: 'a-1', name: 'Wolf' }),
      token('sam', { kind: 'pc', refId: 'p-sam', name: 'Sam' }),
    ],
  };
  return {
    id: 'c-1',
    gm: { id: 'gm-1', name: 'The GM', connected: true },
    players: [
      { id: 'p-alex', name: 'Alex', connected: true, characterId: 'p-alex' },
      { id: 'p-sam', name: 'Sam', connected: true, characterId: 'p-sam' },
    ],
    characters: {},
    fear: 0,
    spotlight: null,
    countdowns: [],
    adversaryInstances: [
      { instanceId: 'a-1', adversaryId: 'acid-burrower', name: 'Wolf', hpMarked: 0, stressMarked: 0, usedFeatures: [] },
    ],
    activeEnvironment: null,
    rest: null,
    consecutiveShortRests: 0,
    groupAction: null,
    tagTeam: null,
    spotlightTokens: null,
    adversaryPools: [],
    map: { ...createMapState(), scenes: [scene], activeSceneId: 's-1' },
    targets,
    journal: [],
    audio: { tracks: [], playing: null },
    tables: [],
    story: { pitch: '', body: '' },
    prepAdversaries: [],
    rollLog: [],
    privateLog: [],
  };
}

describe('targets', () => {
  it('toggles a token in and out, keeping the six most recent', () => {
    expect(toggleTarget([], 'a')).toEqual(['a']);
    expect(toggleTarget(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleTarget(['1', '2', '3', '4', '5', '6'], '7')).toEqual(['2', '3', '4', '5', '6', '7']);
  });

  it('finds an account’s first target that is still on the map', () => {
    const state = room({ 'p-alex': ['gone', 'wolf', 'sam'] });
    expect(firstTarget(state, 'p-alex')?.name).toBe('Wolf');
    expect(firstTarget(state, 'p-sam')).toBeNull();
  });

  it('rings each targeted token in the colour of whoever aims at it', () => {
    const rings = targetRings(room({ 'p-alex': ['wolf'], 'gm-1': ['wolf', 'sam'] }));
    expect(rings.wolf).toEqual([colorFor('p-alex'), GM_COLOR]);
    expect(rings.sam).toEqual([GM_COLOR]);
    expect(rings.marker).toBeUndefined();
  });

  it('finds the adversary a roller is aiming at, by the name the log signs', () => {
    const state = room({ 'p-alex': ['marker', 'wolf'], 'gm-1': ['wolf'] });
    expect(adversaryTargetOf(state, 'Alex')?.instanceId).toBe('a-1');
    expect(adversaryTargetOf(state, 'The GM')?.instanceId).toBe('a-1');
    expect(adversaryTargetOf(state, 'Sam')).toBeNull();
    expect(adversaryTargetOf(room({ 'p-alex': ['sam'] }), 'Alex')).toBeNull();
  });

  it('finds the character behind a PC target', () => {
    expect(pcTargetOf(room({ 'gm-1': ['wolf', 'sam'] }), 'gm-1')).toBe('p-sam');
    expect(pcTargetOf(room({ 'gm-1': ['wolf'] }), 'gm-1')).toBeNull();
  });
});

describe('newestDamageIds', () => {
  const damage = (id: string, by: string): RollEntry => ({
    kind: 'damage',
    id,
    at: 0,
    by,
    label: 'Longsword',
    roll: { rolls: [4], die: 8, criticalBonus: 0, modifier: 1, total: 5 },
    critical: false,
  });
  const message: RollEntry = { kind: 'message', id: 'm', at: 0, by: 'Sam', byId: 'acc-sam', text: 'hit!' };

  it("keeps only each author's newest damage line, from a newest-first feed", () => {
    const feed = [message, damage('d3', 'Sam'), damage('d2', 'Alex'), damage('d1', 'Sam')];
    expect([...newestDamageIds(feed)]).toEqual(['d3', 'd2']);
  });

  it('is empty when nothing was damage', () => {
    expect(newestDamageIds([message]).size).toBe(0);
  });
});
