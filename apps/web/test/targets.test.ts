import { createMapState, createScene, type RoomState, type Token } from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import { GM_COLOR, colorFor } from '../src/state/playerColor.js';
import {
  adversaryTargetOf,
  firstTarget,
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
