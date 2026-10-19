import { seededRng, type Rng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import {
  applyRoomEvent,
  createRoomState,
  mapForPlayer,
  pointInPolygon,
  regionsEntered,
  SceneSchema,
  type Actor,
  type Region,
  type RoomEvent,
  type RoomState,
  type Token,
} from '../src/index.js';

/**
 * Scene regions: polygons the GM draws on a scene. A token whose centre crosses
 * into a hazard tells the GM, and only the GM, what it walked into.
 */

const GM: Actor = { id: 'gm-1', role: 'gm' };
const ALEX: Actor = { id: 'acc-alex', role: 'player' };

const rng: Rng = seededRng(7);
const NOW = 1_700_000_000_000;

const SQUARE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

/** An "L": the top-right quarter of a 100×100 square is cut away. */
const L_SHAPE = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 50, y: 50 },
  { x: 100, y: 50 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const region = (over: Partial<Region> = {}): Region => ({
  id: 'r-1',
  name: 'Lava',
  points: SQUARE,
  effect: 'hazard',
  text: 'Take 1d6 fire damage.',
  visibleToPlayers: true,
  ...over,
});

/** A 50×50 token, so its centre sits at (x + 25, y + 25). */
const token = (over: Partial<Token> = {}): Token => ({
  id: 'tok-1',
  kind: 'pc',
  refId: ALEX.id,
  name: 'Alex',
  x: 200,
  y: 200,
  width: 50,
  height: 50,
  rotation: 0,
  color: '#fff',
  image: null,
  colorFrame: false,
  hidden: false,
  showRings: false,
  ownerId: ALEX.id,
  conditions: [],
  visionRadius: 300,
  dragFrom: null,
  ...over,
});

function result(state: RoomState, actor: Actor, event: RoomEvent) {
  const outcome = applyRoomEvent(state, actor, event, rng, NOW);
  if (!outcome.ok) throw new Error(`rejected: ${outcome.error} ${outcome.message}`);
  return outcome;
}

const apply = (state: RoomState, actor: Actor, event: RoomEvent): RoomState =>
  result(state, actor, event).state;

function refusal(state: RoomState, actor: Actor, event: RoomEvent): string {
  const outcome = applyRoomEvent(state, actor, event, rng, NOW);
  if (outcome.ok) throw new Error('expected a refusal, got a new state');
  return outcome.error;
}

/** An active scene holding Alex's token outside one region. */
function roomWithRegion(over: Partial<Region> = {}): RoomState {
  let room = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
  room = {
    ...room,
    players: [{ id: ALEX.id, name: 'Alex', connected: true, characterId: null }],
  };
  room = apply(room, GM, { type: 'addScene', id: 's-1', name: 'Caldera' });
  room = apply(room, GM, { type: 'setActiveScene', id: 's-1' });
  room = apply(room, GM, { type: 'addToken', sceneId: 's-1', token: token() });
  return apply(room, GM, { type: 'upsertRegion', sceneId: 's-1', region: region(over) });
}

const move = (x: number, y: number, commit: boolean): RoomEvent => ({
  type: 'moveToken',
  sceneId: 's-1',
  tokenId: 'tok-1',
  x,
  y,
  commit,
});

describe('pointInPolygon', () => {
  it('tells inside from outside a square', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 50 }, SQUARE)).toBe(false);
    expect(pointInPolygon({ x: -1, y: 50 }, SQUARE)).toBe(false);
  });

  it('leaves the notch of a concave shape outside', () => {
    expect(pointInPolygon({ x: 75, y: 25 }, L_SHAPE)).toBe(false);
    expect(pointInPolygon({ x: 25, y: 25 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 75, y: 75 }, L_SHAPE)).toBe(true);
  });

  it('counts a point on the border as inside', () => {
    expect(pointInPolygon({ x: 100, y: 50 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 50, y: 0 }, SQUARE)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 0 }, SQUARE)).toBe(true);
    // The inner corner of the L, and its inner edges.
    expect(pointInPolygon({ x: 50, y: 50 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 75, y: 50 }, L_SHAPE)).toBe(true);
  });
});

describe('regionsEntered', () => {
  it('reports a region the token centre crossed into', () => {
    const before = token({ x: 200, y: 200 });
    const after = token({ x: 25, y: 25 });
    expect(regionsEntered(before, after, [region()]).map((r) => r.id)).toEqual(['r-1']);
  });

  it('does not fire for a token that was already inside', () => {
    const before = token({ x: 10, y: 10 });
    const after = token({ x: 40, y: 40 });
    expect(regionsEntered(before, after, [region()])).toEqual([]);
  });

  it('does not fire on leaving', () => {
    const before = token({ x: 25, y: 25 });
    const after = token({ x: 200, y: 200 });
    expect(regionsEntered(before, after, [region()])).toEqual([]);
  });

  it('goes by the centre, not the corner', () => {
    // The corner lands inside, the centre (110, 110) does not.
    const after = token({ x: 85, y: 85 });
    expect(regionsEntered(token(), after, [region()])).toEqual([]);
  });
});

describe('moveToken into a region', () => {
  it('tells the GM alone when a committed move enters a hazard', () => {
    const room = roomWithRegion();
    const outcome = result(room, ALEX, move(25, 25, true));

    expect(outcome.entries).toEqual([]);
    expect(outcome.privateEntries).toHaveLength(1);
    const [logged] = outcome.state.privateLog;
    expect(logged?.audience).toEqual([]);
    expect(logged?.entry).toMatchObject({
      kind: 'message',
      by: 'Alex',
      byId: ALEX.id,
      text: '«Alex» entró en «Lava»: Take 1d6 fire damage.',
    });
    expect(outcome.privateEntries[0]).toEqual(logged);
    expect(outcome.state.rollLog).toEqual([]);
  });

  it('does not fire on a drag preview', () => {
    const outcome = result(roomWithRegion(), ALEX, move(25, 25, false));
    expect(outcome.privateEntries).toEqual([]);
    expect(outcome.state.privateLog).toEqual([]);
  });

  it('fires on the release even when the last preview was already inside', () => {
    let room = roomWithRegion();
    room = apply(room, ALEX, move(120, 120, false));
    room = apply(room, ALEX, move(30, 30, false));
    const outcome = result(room, ALEX, move(25, 25, true));
    expect(outcome.privateEntries).toHaveLength(1);
    // The drag is over, so the next one starts from where this one ended.
    const moved = outcome.state.map.scenes[0]?.tokens[0];
    expect(moved?.dragFrom).toBeNull();
    expect(result(outcome.state, ALEX, move(40, 40, true)).privateEntries).toEqual([]);
  });

  it('says nothing for a region that is not a hazard', () => {
    const outcome = result(roomWithRegion({ effect: 'difficultTerrain' }), ALEX, move(25, 25, true));
    expect(outcome.privateEntries).toEqual([]);
    expect(outcome.state.privateLog).toEqual([]);
  });
});

describe('Token.dragFrom is server-owned', () => {
  it('ignores a forged dragFrom sent with addToken', () => {
    let room = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
    room = apply(room, GM, { type: 'addScene', id: 's-1', name: 'Caldera' });
    room = apply(room, GM, {
      type: 'addToken',
      sceneId: 's-1',
      token: token({ dragFrom: { x: 9, y: 9 } }),
    });
    expect(room.map.scenes[0]?.tokens[0]?.dragFrom).toBeNull();
  });

  it('preserves the stored dragFrom across a GM updateToken', () => {
    let room = roomWithRegion();
    // Start a drag preview so the token carries a non-null dragFrom.
    room = apply(room, ALEX, move(120, 120, false));
    const midDrag = room.map.scenes[0]?.tokens[0];
    expect(midDrag?.dragFrom).toEqual({ x: 200, y: 200 });

    room = apply(room, GM, {
      type: 'updateToken',
      sceneId: 's-1',
      token: { ...token(), name: 'Renamed', dragFrom: { x: 999, y: 999 } },
    });
    const updated = room.map.scenes[0]?.tokens[0];
    expect(updated?.name).toBe('Renamed');
    expect(updated?.dragFrom).toEqual({ x: 200, y: 200 });
  });
});

describe('region intents', () => {
  it('lets the GM add, replace and remove a region', () => {
    let room = roomWithRegion();
    room = apply(room, GM, {
      type: 'upsertRegion',
      sceneId: 's-1',
      region: region({ name: 'Cooled lava' }),
    });
    expect(room.map.scenes[0]?.regions.map((r) => r.name)).toEqual(['Cooled lava']);
    room = apply(room, GM, { type: 'removeRegion', sceneId: 's-1', regionId: 'r-1' });
    expect(room.map.scenes[0]?.regions).toEqual([]);
  });

  it('refuses a player', () => {
    const room = roomWithRegion();
    expect(
      refusal(room, ALEX, { type: 'upsertRegion', sceneId: 's-1', region: region({ id: 'r-2' }) }),
    ).toBe('notGameMaster');
    expect(refusal(room, ALEX, { type: 'removeRegion', sceneId: 's-1', regionId: 'r-1' })).toBe(
      'notGameMaster',
    );
  });

  it('refuses an unknown scene', () => {
    expect(
      refusal(roomWithRegion(), GM, { type: 'upsertRegion', sceneId: 'nope', region: region() }),
    ).toBe('unknownScene');
  });
});

describe('regions in the player view', () => {
  it('drops hidden regions and the text of hazards', () => {
    const room = roomWithRegion();
    const withMore = apply(
      apply(room, GM, {
        type: 'upsertRegion',
        sceneId: 's-1',
        region: region({ id: 'r-2', name: 'Trapdoor', visibleToPlayers: false }),
      }),
      GM,
      {
        type: 'upsertRegion',
        sceneId: 's-1',
        region: region({ id: 'r-3', name: 'Shrine', effect: 'note', text: 'Old gods.' }),
      },
    );
    const regions = mapForPlayer(withMore.map).scenes[0]?.regions ?? [];
    expect(regions.map((r) => r.id)).toEqual(['r-1', 'r-3']);
    expect(regions[0]?.text).toBe('');
    expect(regions[1]?.text).toBe('Old gods.');
  });

  it('loads a scene saved before regions existed', () => {
    const scene = SceneSchema.parse({
      id: 's-1',
      name: 'Old',
      image: null,
      grid: { mode: 'none', size: 50, offsetX: 0, offsetY: 0, feetPerInch: 5 },
      tokens: [],
      fog: { enabled: false, cellSize: 50, cols: 0, rows: 0, revealed: [] },
    });
    expect(scene.regions).toEqual([]);
  });
});
