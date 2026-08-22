import { describe, expect, it } from 'vitest';

import {
  SceneSchema,
  cellsInBrush,
  createScene,
  fitFogToImage,
  hide,
  isRevealed,
  mapForPlayer,
  reveal,
  type Fog,
  type MapState,
  type Token,
} from '../src/index.js';

const fog = (over: Partial<Fog> = {}): Fog => ({
  enabled: true,
  cellSize: 50,
  cols: 10,
  rows: 10,
  revealed: [],
  ...over,
});

const token = (over: Partial<Token> = {}): Token => ({
  id: 't1',
  kind: 'pc',
  refId: 'pc1',
  name: 'Alice',
  x: 100,
  y: 100,
  width: 50,
  height: 50,
  rotation: 0,
  ownerId: 'player-1',
  hidden: false,
  showRings: false,
  color: '#e2b857',
  image: null,
  colorFrame: false,
  visionRadius: 720,
  ...over,
});

describe('fog', () => {
  it('sizes its grid to the scene image', () => {
    const fitted = fitFogToImage(fog({ cols: 0, rows: 0 }), {
      url: '/uploads/a.png',
      width: 1000,
      height: 500,
    });
    expect(fitted.cols).toBe(20);
    expect(fitted.rows).toBe(10);
  });

  it('brushes the cells a stroke actually covers', () => {
    // A small brush at the centre of one cell covers only that cell.
    const cells = cellsInBrush(fog(), { x: 25, y: 25 }, 10);
    expect(cells).toEqual([0]);

    // A wider brush spreads into neighbours.
    const wider = cellsInBrush(fog(), { x: 50, y: 50 }, 40);
    expect(wider.length).toBeGreaterThan(1);
    expect(wider).toContain(0);
  });

  it('clamps a brush at the edges of the map', () => {
    const cells = cellsInBrush(fog(), { x: 0, y: 0 }, 200);
    expect(cells.every((cell) => cell >= 0 && cell < 100)).toBe(true);
  });

  it('reveals and hides cells, keeping the list sorted and unique', () => {
    let current = reveal(fog(), [5, 1, 5, 3]);
    expect(current.revealed).toEqual([1, 3, 5]);

    current = reveal(current, [2]);
    expect(current.revealed).toEqual([1, 2, 3, 5]);

    current = hide(current, [2, 3]);
    expect(current.revealed).toEqual([1, 5]);
  });

  it('reports whether a point is revealed', () => {
    const revealed = reveal(fog(), [0]);
    expect(isRevealed(revealed, { x: 10, y: 10 })).toBe(true);
    expect(isRevealed(revealed, { x: 200, y: 200 })).toBe(false);
    // Off the map is not revealed.
    expect(isRevealed(revealed, { x: -10, y: 0 })).toBe(false);
  });

  it('treats everything as visible when fog is switched off', () => {
    expect(isRevealed(fog({ enabled: false }), { x: 900, y: 900 })).toBe(true);
  });
});

describe('what a player is sent', () => {
  const map: MapState = {
    activeSceneId: 'scene-1',
    scenes: [
      {
        ...createScene('scene-1', 'The Bridge'),
        tokens: [token(), token({ id: 't2', name: 'Ambusher', hidden: true, ownerId: null })],
        fog: reveal(fog(), [0, 1, 2]),
      },
      { ...createScene('scene-2', 'Backstage'), tokens: [token({ id: 't3' })] },
    ],
  };

  it('sends only the active scene', () => {
    const view = mapForPlayer(map);
    expect(view.scenes).toHaveLength(1);
    expect(view.scenes[0]?.id).toBe('scene-1');
    expect(view.activeSceneId).toBe('scene-1');
    // The inactive scene and its tokens are absent entirely.
    expect(JSON.stringify(view)).not.toContain('scene-2');
    expect(JSON.stringify(view)).not.toContain('t3');
  });

  it('strips GM-only tokens', () => {
    const view = mapForPlayer(map);
    expect(view.scenes[0]?.tokens.map((t) => t.id)).toEqual(['t1']);
    expect(JSON.stringify(view)).not.toContain('Ambusher');
  });

  it('sends revealed cells only, so unrevealed regions never leave the server', () => {
    const view = mapForPlayer(map);
    const sent = view.scenes[0]?.fog;
    expect(sent?.revealed).toEqual([0, 1, 2]);
    // 100 cells exist; the payload describes 3. The rest are absent, not hidden.
    expect(sent?.revealed.length).toBeLessThan((sent?.cols ?? 0) * (sent?.rows ?? 0));
  });

  it('sends nothing when no scene is active', () => {
    const view = mapForPlayer({ ...map, activeSceneId: null });
    expect(view.scenes).toEqual([]);
    expect(view.activeSceneId).toBeNull();
  });

  it('passes a token portrait through untouched', () => {
    const portrait = { url: '/uploads/orc.png', width: 128, height: 128 };
    const withImage: MapState = {
      ...map,
      scenes: [{ ...map.scenes[0]!, tokens: [token({ image: portrait })] }, ...map.scenes.slice(1)],
    };
    const view = mapForPlayer(withImage);
    expect(view.scenes[0]?.tokens[0]?.image).toEqual(portrait);
  });
});

describe('walls', () => {
  it('defaults visionMode to manual and walls to empty on a fresh scene', () => {
    const scene = createScene('s1', 'Fresh');
    expect(scene.visionMode).toBe('manual');
    expect(scene.walls).toEqual([]);
  });

  it('parses a scene saved before walls/visionMode existed', () => {
    // Simulates a pre-existing snapshot record: no `walls`, no `visionMode`.
    const legacy = { ...createScene('s2', 'Legacy') } as Record<string, unknown>;
    delete legacy.walls;
    delete legacy.visionMode;
    const parsed = SceneSchema.parse(legacy);
    expect(parsed.visionMode).toBe('manual');
    expect(parsed.walls).toEqual([]);
  });

  it('never sends wall geometry to a player', () => {
    const withWalls: MapState = {
      activeSceneId: 'scene-1',
      scenes: [
        {
          ...createScene('scene-1', 'Vault'),
          walls: [{ id: 'w1', x1: 0, y1: 0, x2: 100, y2: 0, kind: 'wall', open: false }],
          tokens: [token()],
        },
      ],
    };
    const view = mapForPlayer(withWalls);
    expect(view.scenes[0]?.walls).toEqual([]);
  });
});
