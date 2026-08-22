# Dynamic Vision (Line-of-Sight) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players see only what their character's vision actually reaches — a
radius around their token, blocked by GM-drawn walls/doors — computed
automatically per scene, instead of the GM hand-painting fog reveals.

**Architecture:** A pure ray-casting visibility-polygon function
(`packages/protocol/src/vision.ts`) computes what a token sees from its
position, a vision radius, and the scene's wall segments. The server runs it
inside the existing `moveToken`/`addToken` reducer cases whenever a scene is
in `visionMode: 'auto'`, feeding the result into the *same* `Fog.revealed`
cell-index set the manual paint brush already writes to — so the existing
broadcast, role-filtering (`mapForPlayer`), and rendering (`FogLayer`)
pipeline needs no changes at all. Manual and auto modes stay mutually
exclusive per scene, chosen by the GM.

**Tech Stack:** TypeScript, Zod (schemas), Vitest (tests), React + Konva
(map canvas), Socket.IO (already-generic event dispatch — no gateway changes
needed, same as every other map event).

**Spec:** `docs/superpowers/specs/2026-08-21-dynamic-vision-design.md`

## Global Constraints

- Every new persisted field on `Scene`/`Token` ships with a Zod `.default()`
  (or is additive-only) — a campaign snapshot saved before the field existed
  must still restore. (Learned from a real incident: a required-field schema
  change once wiped a whole campaign's saved data.)
- Walls are never sent to players over the wire — same trust posture the
  fog/hidden-token filtering already uses (`mapForPlayer`).
- No changes to `apps/server/src/gateway.ts` are needed anywhere in this
  plan — it dispatches every `RoomEvent` generically already.

---

### Task 1: Schema — `Wall`, `VisionMode`, `Scene.walls`/`visionMode`, `Token.visionRadius`

**Files:**
- Modify: `packages/protocol/src/map.ts`
- Modify: `packages/protocol/test/map.test.ts`
- Modify: `apps/server/test/map.test.ts` (its local `token()` fixture)
- Modify: `apps/web/src/routes/MapRoute.tsx` (its two token-literal builders)

**Interfaces:**
- Produces: `WallSchema`/`Wall` (`{id, x1, y1, x2, y2, kind: 'wall'|'door',
  open: boolean}`), `VisionModeSchema`/`VisionMode` (`'manual'|'auto'`),
  `Scene.walls: Wall[]`, `Scene.visionMode: VisionMode`,
  `Token.visionRadius: number` — all exported from `@daggerheart/protocol`
  (re-exported via `packages/protocol/src/index.ts`'s existing
  `export * from './map.js'`, no change needed there).
- Produces: `mapForPlayer` now strips `walls` to `[]` for players (they must
  never see wall geometry, matching the existing "never receives unrevealed
  fog" comment on that function).

- [ ] **Step 1: Write the failing tests**

Add to `packages/protocol/test/map.test.ts`, inside the existing `token`
fixture and as new assertions. Read the file first — it currently has a
`token(over: Partial<Token> = {})` fixture and a `describe('what a player is
sent', ...)` block with a `map: MapState` fixture built from `createScene`.

Add this new `describe` block at the end of the file (after the existing
`describe('what a player is sent', ...)` block's closing `});`):

```ts
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
```

Add `SceneSchema` to the existing import list at the top of the file (it
currently imports `cellsInBrush, createScene, fitFogToImage, hide,
isRevealed, mapForPlayer, reveal` and the types `Fog, MapState, Token` from
`'../src/index.js'`):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @daggerheart/protocol test`
Expected: FAIL — `scene.visionMode`/`scene.walls` are `undefined`, and
`SceneSchema` parse of the legacy object throws (no default yet), and the
wall-stripping test fails because `mapForPlayer` doesn't touch `walls`.

- [ ] **Step 3: Add the schema**

In `packages/protocol/src/map.ts`, add `WallSchema`/`VisionModeSchema`
right after `GridSchema` (before `SceneSchema`, which references them):

```ts
export const WallKindSchema = z.enum(['wall', 'door']);
export type WallKind = z.infer<typeof WallKindSchema>;

export const WallSchema = z.object({
  id: z.string().min(1).max(64),
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  kind: WallKindSchema.default('wall'),
  /** Doors only. Open doors don't block vision. Ignored for plain walls. */
  open: z.boolean().default(false),
});
export type Wall = z.infer<typeof WallSchema>;

/** `auto` computes fog reveals from wall geometry; `manual` is the GM's brush. */
export const VisionModeSchema = z.enum(['manual', 'auto']);
export type VisionMode = z.infer<typeof VisionModeSchema>;
```

Update `SceneSchema` to add the two new fields:

```ts
export const SceneSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  image: SceneImageSchema.nullable(),
  grid: GridSchema,
  tokens: z.array(TokenSchema).max(200),
  fog: FogSchema,
  walls: z.array(WallSchema).max(500).default([]),
  visionMode: VisionModeSchema.default('manual'),
});
export type Scene = z.infer<typeof SceneSchema>;
```

Update `TokenSchema` to add `visionRadius` (right after `colorFrame`):

```ts
  colorFrame: z.boolean().default(false),
  /** Pixels a `pc` token can see in `visionMode: 'auto'`. Ignored otherwise. */
  visionRadius: z.number().min(0).max(4000).default(720),
});
```

Update `createScene` to construct the fields explicitly (it returns a plain
object literal typed as `Scene`, so TypeScript requires every field present
even though the schema has defaults for *parsed* input):

```ts
export function createScene(id: string, name: string): Scene {
  return {
    id,
    name,
    image: null,
    grid: DEFAULT_GRID,
    tokens: [],
    fog: DEFAULT_FOG,
    walls: [],
    visionMode: 'manual',
  };
}
```

Update `mapForPlayer` to strip walls:

```ts
export function mapForPlayer(map: MapState): MapState {
  const active = map.scenes.find((scene) => scene.id === map.activeSceneId);
  if (active === undefined) return { scenes: [], activeSceneId: null };

  return {
    activeSceneId: map.activeSceneId,
    scenes: [{ ...active, tokens: active.tokens.filter((token) => !token.hidden), walls: [] }],
  };
}
```

- [ ] **Step 4: Fix the other Token-literal construction sites**

`Token` is a plain TS type, not something built by parsing — every literal
object typed as `Token` in the codebase needs `visionRadius` added by hand.

In `apps/server/test/map.test.ts`, the `token()` fixture:

```ts
const token = (over: Partial<Token> = {}): Token => ({
  id: 'tok-1',
  kind: 'pc',
  refId: 'pc1',
  name: 'Alice',
  x: 100,
  y: 100,
  width: 50,
  height: 50,
  rotation: 0,
  ownerId: null,
  hidden: false,
  showRings: false,
  color: '#e2b857',
  image: null,
  colorFrame: false,
  visionRadius: 720,
  ...over,
});
```

In `packages/protocol/test/map.test.ts`, the `token()` fixture gets the same
`visionRadius: 720,` line added right after `colorFrame: false,`.

In `apps/web/src/routes/MapRoute.tsx`, the `base()` helper inside
`TokenTools` (search for `const base = (name: string, color: string):
Omit<Token, 'kind' | 'refId' | 'ownerId'>`) gets `visionRadius: 720,` added
after `colorFrame: false,`. The `placeMyToken` function's inline token
literal (search for `type: 'addToken'` inside `placeMyToken`) gets the same
line added after its own `colorFrame: false,`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -F @daggerheart/protocol test`
Expected: PASS — all three new tests green, plus the pre-existing
`map.test.ts` tests still pass (they use `token()`/`createScene()`, both
updated above).

Run: `pnpm -F @daggerheart/server typecheck && pnpm -F @daggerheart/web typecheck`
Expected: both PASS — confirms the `Token`-literal fixes above are complete
(a missing `visionRadius` anywhere shows up as a type error).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/map.ts packages/protocol/test/map.test.ts \
  apps/server/test/map.test.ts apps/web/src/routes/MapRoute.tsx
git commit -m "feat(protocol): add Wall/VisionMode schema, Token.visionRadius"
```

---

### Task 2: Vision algorithm — `computeVisionPolygon`

**Files:**
- Create: `packages/protocol/src/vision.ts`
- Create: `packages/protocol/test/vision.test.ts`

**Interfaces:**
- Consumes: `Wall` type from Task 1 (`packages/protocol/src/map.js`).
- Produces: `computeVisionPolygon(origin: {x: number; y: number}, radius:
  number, walls: readonly Wall[], bounds: {width: number; height: number}):
  {x: number; y: number}[]` — a polygon of points, in scene-pixel
  coordinates, sorted so consecutive points trace the polygon boundary.

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/test/vision.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { computeVisionPolygon } from '../src/vision.js';
import type { Wall } from '../src/map.js';

const bounds = { width: 1000, height: 1000 };

const wall = (over: Partial<Wall> = {}): Wall => ({
  id: 'w1',
  x1: 0,
  y1: 0,
  x2: 0,
  y2: 0,
  kind: 'wall',
  open: false,
  ...over,
});

describe('computeVisionPolygon', () => {
  it('returns a polygon roughly the size of the radius when nothing blocks it', () => {
    const polygon = computeVisionPolygon({ x: 500, y: 500 }, 100, [], bounds);
    expect(polygon.length).toBeGreaterThan(8);
    for (const point of polygon) {
      const distance = Math.hypot(point.x - 500, point.y - 500);
      expect(distance).toBeLessThanOrEqual(100 + 1e-6);
    }
    // At least one point should reach close to the full radius (an open area
    // isn't clipped down to something much smaller).
    const maxDistance = Math.max(...polygon.map((p) => Math.hypot(p.x - 500, p.y - 500)));
    expect(maxDistance).toBeGreaterThan(95);
  });

  it('stops at a wall directly between the origin and the radius edge', () => {
    // A vertical wall 50px to the right of the origin, taller than the radius.
    const blocker = wall({ x1: 550, y1: 400, x2: 550, y2: 600 });
    const polygon = computeVisionPolygon({ x: 500, y: 500 }, 200, [blocker], bounds);

    // No point of the polygon should lie meaningfully past the wall (x > 555)
    // in the direction straight toward it (y close to 500).
    const beyondWall = polygon.filter((p) => p.x > 555 && Math.abs(p.y - 500) < 20);
    expect(beyondWall).toHaveLength(0);
  });

  it('ignores an open door — vision passes through', () => {
    const door = wall({ x1: 550, y1: 400, x2: 550, y2: 600, kind: 'door', open: true });
    const polygon = computeVisionPolygon({ x: 500, y: 500 }, 200, [door], bounds);
    const pastDoor = polygon.some((p) => p.x > 600 && Math.abs(p.y - 500) < 20);
    expect(pastDoor).toBe(true);
  });

  it('a closed door blocks exactly like a wall', () => {
    const door = wall({ x1: 550, y1: 400, x2: 550, y2: 600, kind: 'door', open: false });
    const polygon = computeVisionPolygon({ x: 500, y: 500 }, 200, [door], bounds);
    const pastDoor = polygon.some((p) => p.x > 600 && Math.abs(p.y - 500) < 20);
    expect(pastDoor).toBe(false);
  });

  it('never returns a point outside the scene bounds', () => {
    const polygon = computeVisionPolygon({ x: 10, y: 10 }, 500, [], { width: 200, height: 200 });
    for (const point of polygon) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(200);
      expect(point.y).toBeLessThanOrEqual(200);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @daggerheart/protocol test`
Expected: FAIL — `Cannot find module '../src/vision.js'`

- [ ] **Step 3: Write the implementation**

Create `packages/protocol/src/vision.ts`:

```ts
import type { Wall } from './map.js';

/**
 * Ray-casting visibility polygon: what a token at `origin` can see out to
 * `radius`, blocked by closed walls/doors. Pure and has no canvas/socket
 * dependency — the server runs it to decide what to persist as revealed fog,
 * the client can run the exact same function to render instantly.
 */

interface Point {
  x: number;
  y: number;
}

/** Evenly-spaced fallback rays, so open areas render as a smooth circle
 * rather than a jagged polygon with only as many sides as nearby walls. */
const FALLBACK_RAY_COUNT = 64;
/** Nudges a ray angle just past a wall's exact endpoint, so a ray aimed
 * precisely at a corner doesn't land ambiguously on either side of it. */
const CORNER_EPSILON = 1e-4;

function blockingWalls(walls: readonly Wall[]): Wall[] {
  return walls.filter((wall) => wall.kind === 'wall' || (wall.kind === 'door' && !wall.open));
}

/** Nearest distance along a ray from `origin` at `angle` to a wall segment,
 * or `null` if the ray misses the segment entirely. */
function rayIntersectsSegment(
  origin: Point,
  angle: number,
  wall: Wall,
): number | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  const sx = wall.x2 - wall.x1;
  const sy = wall.y2 - wall.y1;

  const denominator = dx * sy - dy * sx;
  if (Math.abs(denominator) < 1e-10) return null; // parallel

  const t = ((wall.x1 - origin.x) * sy - (wall.y1 - origin.y) * sx) / denominator;
  const u = ((wall.x1 - origin.x) * dy - (wall.y1 - origin.y) * dx) / denominator;

  if (t < 0 || u < 0 || u > 1) return null;
  return t;
}

function castRay(origin: Point, angle: number, radius: number, walls: readonly Wall[]): Point {
  let nearest = radius;
  for (const wall of walls) {
    const distance = rayIntersectsSegment(origin, angle, wall);
    if (distance !== null && distance < nearest) nearest = distance;
  }
  return { x: origin.x + Math.cos(angle) * nearest, y: origin.y + Math.sin(angle) * nearest };
}

export function computeVisionPolygon(
  origin: Point,
  radius: number,
  walls: readonly Wall[],
  bounds: { width: number; height: number },
): Point[] {
  const blockers = blockingWalls(walls);

  const angles = new Set<number>();
  for (let i = 0; i < FALLBACK_RAY_COUNT; i++) {
    angles.add((i / FALLBACK_RAY_COUNT) * Math.PI * 2);
  }
  for (const wall of blockers) {
    for (const corner of [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }]) {
      const angle = Math.atan2(corner.y - origin.y, corner.x - origin.x);
      angles.add(angle - CORNER_EPSILON);
      angles.add(angle);
      angles.add(angle + CORNER_EPSILON);
    }
  }

  const points = [...angles]
    .sort((a, b) => a - b)
    .map((angle) => castRay(origin, angle, radius, blockers))
    .map((point) => ({
      x: Math.min(Math.max(point.x, 0), bounds.width),
      y: Math.min(Math.max(point.y, 0), bounds.height),
    }));

  return points;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @daggerheart/protocol test`
Expected: PASS — all 5 `vision.test.ts` cases green.

- [ ] **Step 5: Wire it into the package export**

`packages/protocol/src/index.ts` needs one new line (alongside the existing
`export * from './map.js';`):

```ts
export * from './vision.js';
```

Run `pnpm -F @daggerheart/protocol typecheck` — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/vision.ts packages/protocol/test/vision.test.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): add computeVisionPolygon ray-casting algorithm"
```

---

### Task 3: `cellsInPolygon` fog helper

**Files:**
- Modify: `packages/protocol/src/map.ts`
- Modify: `packages/protocol/test/map.test.ts`

**Interfaces:**
- Consumes: `Fog` type (already in `map.ts`), a polygon (`{x,y}[]` from
  Task 2's `computeVisionPolygon`).
- Produces: `cellsInPolygon(fog: Fog, polygon: readonly {x: number; y:
  number}[]): number[]` — fog cell indices whose center falls inside the
  polygon, in the same index scheme `cellsInBrush`/`reveal` already use.

- [ ] **Step 1: Write the failing test**

Add to `packages/protocol/test/map.test.ts`, inside the existing `describe`
structure — add a new `describe('cellsInPolygon', ...)` block (place it
right after the existing `describe('fog', ...)` block, before `describe('what
a player is sent', ...)`):

```ts
describe('cellsInPolygon', () => {
  it('reveals cells whose centre falls inside a square polygon', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    // 10x10 grid of 50px cells → cells 0..3 (rows 0-1, cols 0-1) have
    // centres at (25,25),(75,25),(25,75),(75,75), all inside the square.
    const cells = cellsInPolygon(fog(), square);
    expect(cells.sort((a, b) => a - b)).toEqual([0, 1, 10, 11]);
  });

  it('reveals nothing for an empty polygon', () => {
    expect(cellsInPolygon(fog(), [])).toEqual([]);
  });
});
```

Add `cellsInPolygon` to the existing import list from `'../src/index.js'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @daggerheart/protocol test`
Expected: FAIL — `cellsInPolygon is not a function` / not exported.

- [ ] **Step 3: Implement it**

In `packages/protocol/src/map.ts`, add this next to `cellsInBrush` (in the
"fog helpers" section):

```ts
/** Point-in-polygon test (even-odd rule), for `cellsInPolygon` below. */
function pointInPolygon(point: { x: number; y: number }, polygon: readonly { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** The fog cell indices whose centre falls inside a vision polygon. */
export function cellsInPolygon(fog: Fog, polygon: readonly { x: number; y: number }[]): number[] {
  if (polygon.length === 0 || fog.cols === 0 || fog.rows === 0) return [];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const minCol = Math.max(0, Math.floor(minX / fog.cellSize));
  const maxCol = Math.min(fog.cols - 1, Math.floor(maxX / fog.cellSize));
  const minRow = Math.max(0, Math.floor(minY / fog.cellSize));
  const maxRow = Math.min(fog.rows - 1, Math.floor(maxY / fog.cellSize));

  const cells: number[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const centre = { x: col * fog.cellSize + fog.cellSize / 2, y: row * fog.cellSize + fog.cellSize / 2 };
      if (pointInPolygon(centre, polygon)) cells.push(row * fog.cols + col);
    }
  }
  return cells;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @daggerheart/protocol test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/map.ts packages/protocol/test/map.test.ts
git commit -m "feat(protocol): add cellsInPolygon fog helper"
```

---

### Task 4: Wall CRUD events — `addWall`/`removeWall`/`updateWall`/`setSceneVisionMode`

**Files:**
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/room.ts`
- Modify: `apps/server/test/map.test.ts`

**Interfaces:**
- Consumes: `WallSchema`, `VisionModeSchema` from Task 1.
- Produces: four new `RoomEvent` variants, all GM-only, dispatched through
  the existing generic `applyMapEvent` GM-gate (no new authorization
  mechanism — same pattern as `addScene`/`setSceneGrid`).

- [ ] **Step 1: Write the failing tests**

Add to `apps/server/test/map.test.ts`. Read the file first for the exact
`tableWithScene` helper and existing test style (it uses
`gmClient.emit(CHANNEL.intent, {...})`, `player.client.next<{error:
string}>(CHANNEL.rejected)`, and `server.campaigns.get(campaignId)?.state`).

Add this new test inside the existing `describe('map sync', ...)` block, near
the `it('rejects every other map mutation from a player', ...)` test:

```ts
  it('lets the GM manage walls and vision mode, but never a player', async () => {
    const { gmClient, player, campaignId } = await tableWithScene(server, 'walls-a');

    const added = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.walls?.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addWall',
      sceneId: 'scene-1',
      wall: { id: 'w1', x1: 0, y1: 0, x2: 100, y2: 0, kind: 'wall', open: false },
    });
    await added;
    expect(server.campaigns.get(campaignId)?.state.map.scenes[0]?.walls).toHaveLength(1);

    const doored = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.walls?.[0]?.open === true,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'updateWall',
      sceneId: 'scene-1',
      wall: { id: 'w1', x1: 0, y1: 0, x2: 100, y2: 0, kind: 'door', open: true },
    });
    await doored;

    const modeSet = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => p.map?.scenes[0]?.visionMode === 'auto',
    );
    gmClient.emit(CHANNEL.intent, { type: 'setSceneVisionMode', sceneId: 'scene-1', visionMode: 'auto' });
    await modeSet;

    const removed = gmClient.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.walls?.length ?? 0) === 0,
    );
    gmClient.emit(CHANNEL.intent, { type: 'removeWall', sceneId: 'scene-1', wallId: 'w1' });
    await removed;

    const playerIntents: unknown[] = [
      { type: 'addWall', sceneId: 'scene-1', wall: { id: 'sneaky', x1: 0, y1: 0, x2: 1, y2: 1, kind: 'wall', open: false } },
      { type: 'removeWall', sceneId: 'scene-1', wallId: 'w1' },
      { type: 'updateWall', sceneId: 'scene-1', wall: { id: 'w1', x1: 0, y1: 0, x2: 1, y2: 1, kind: 'wall', open: false } },
      { type: 'setSceneVisionMode', sceneId: 'scene-1', visionMode: 'auto' },
    ];
    for (const intent of playerIntents) {
      const rejected = player.client.next<{ error: string }>(CHANNEL.rejected);
      player.client.emit(CHANNEL.intent, intent);
      expect((await rejected).error, JSON.stringify(intent)).toBe('notGameMaster');
    }

    gmClient.close();
    player.client.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @daggerheart/server test`
Expected: FAIL — the new event types don't parse (`RoomEventSchema` rejects
them, so the intent is silently dropped and the `until(...)` promises never
resolve/time out, or the reducer throws on an unhandled case).

- [ ] **Step 3: Add the event schemas**

In `packages/protocol/src/events.ts`, add `WallSchema, VisionModeSchema` to
the existing import from `'./map.js'` (currently `GridSchema,
SceneImageSchema, TokenSchema`):

```ts
import { GridSchema, SceneImageSchema, TokenSchema, VisionModeSchema, WallSchema } from './map.js';
```

Add four entries to `MapRoomEventSchema`'s discriminated union (right after
the existing `setFogEnabled` entry, before the closing `]);`):

```ts
  z.object({ type: z.literal('addWall'), sceneId, wall: WallSchema }),
  z.object({ type: z.literal('removeWall'), sceneId, wallId: z.string().min(1).max(64) }),
  z.object({ type: z.literal('updateWall'), sceneId, wall: WallSchema }),
  z.object({ type: z.literal('setSceneVisionMode'), sceneId, visionMode: VisionModeSchema }),
```

- [ ] **Step 4: Add the reducer cases**

In `packages/protocol/src/room.ts`, add the four new event types to the
existing GM-only dispatch list (the `case 'addScene': case 'renameScene':
... return applyMapEvent(state, actor, event);` block):

```ts
    case 'addScene':
    case 'renameScene':
    case 'removeScene':
    case 'setActiveScene':
    case 'setSceneImage':
    case 'setSceneGrid':
    case 'updateToken':
    case 'removeToken':
    case 'paintFog':
    case 'setFogEnabled':
    case 'addWall':
    case 'removeWall':
    case 'updateWall':
    case 'setSceneVisionMode':
      return applyMapEvent(state, actor, event);
```

Update `applyMapEvent`'s parameter type to include the new cases (it
currently excludes only `'moveToken' | 'addToken'`):

```ts
function applyMapEvent(
  state: RoomState,
  actor: Actor,
  event: Exclude<MapRoomEvent, { type: 'moveToken' | 'addToken' }>,
): RoomResult {
```

(No change needed to that exclusion — it already covers exactly the two
carve-out cases; the new wall events are GM-only like everything else
`applyMapEvent` already handles.)

Add the four `case` bodies inside `applyMapEvent`'s `switch (event.type)`,
right after the existing `setFogEnabled` case:

```ts
    case 'addWall': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      return ok(withScene(state, scene.id, { ...scene, walls: [...scene.walls, event.wall] }));
    }

    case 'removeWall': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      return ok(
        withScene(state, scene.id, {
          ...scene,
          walls: scene.walls.filter((wall) => wall.id !== event.wallId),
        }),
      );
    }

    case 'updateWall': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      return ok(
        withScene(state, scene.id, {
          ...scene,
          walls: scene.walls.map((wall) => (wall.id === event.wall.id ? event.wall : wall)),
        }),
      );
    }

    case 'setSceneVisionMode': {
      const scene = findScene(event.sceneId);
      if (scene === undefined) return fail('unknownScene', 'no such scene');
      return ok(withScene(state, scene.id, { ...scene, visionMode: event.visionMode }));
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -F @daggerheart/server test`
Expected: PASS.

Run: `pnpm -F @daggerheart/protocol typecheck && pnpm -F @daggerheart/server typecheck`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/events.ts packages/protocol/src/room.ts apps/server/test/map.test.ts
git commit -m "feat(protocol): add addWall/removeWall/updateWall/setSceneVisionMode events"
```

---

### Task 5: Auto-reveal — wire vision into `moveToken`/`addToken`

**Files:**
- Modify: `packages/protocol/src/room.ts`
- Modify: `apps/server/test/map.test.ts`

**Interfaces:**
- Consumes: `computeVisionPolygon` (Task 2), `cellsInPolygon` (Task 3),
  `reveal` (already imported in `room.ts`).
- Produces: whenever a `pc` token moves or is added on a scene with
  `visionMode: 'auto'`, that scene's `Fog.revealed` gains whatever cells the
  mover's vision polygon covers — no new `RoomEvent`, this rides inside the
  existing two cases.

- [ ] **Step 1: Write the failing test**

Add to `apps/server/test/map.test.ts`:

```ts
  it('auto-reveals fog around a player token when the scene is in auto vision mode', async () => {
    const { gmClient, player, campaignId, playerId } = await tableWithScene(server, 'walls-b');

    gmClient.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    gmClient.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    gmClient.emit(CHANNEL.intent, { type: 'setSceneVisionMode', sceneId: 'scene-1', visionMode: 'auto' });

    const revealed = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.fog.revealed.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'auto-1', kind: 'pc', refId: playerId, ownerId: playerId, x: 500, y: 500 }),
    });

    const patch = await revealed;
    const playerFog = patch.map?.scenes[0]?.fog;
    expect(playerFog).toBeDefined();
    if (playerFog === undefined) return;
    expect(playerFog.revealed.length).toBeGreaterThan(0);

    const serverFog = server.campaigns.get(campaignId)?.state.map.scenes[0]?.fog;
    expect(serverFog?.revealed).toEqual(playerFog.revealed);

    gmClient.close();
    player.client.close();
  });

  it('does not auto-reveal in manual mode', async () => {
    const { gmClient, player, playerId } = await tableWithScene(server, 'walls-c');

    gmClient.emit(CHANNEL.intent, {
      type: 'setSceneImage',
      sceneId: 'scene-1',
      image: { url: '/uploads/test.png', width: 1000, height: 1000 },
    });
    gmClient.emit(CHANNEL.intent, { type: 'setFogEnabled', sceneId: 'scene-1', enabled: true });
    // visionMode left at its default: 'manual'.

    const added = player.client.until<RoomPatch>(
      CHANNEL.roomPatch,
      (p) => (p.map?.scenes[0]?.tokens.length ?? 0) > 0,
    );
    gmClient.emit(CHANNEL.intent, {
      type: 'addToken',
      sceneId: 'scene-1',
      token: token({ id: 'manual-1', kind: 'pc', refId: playerId, ownerId: playerId, x: 500, y: 500 }),
    });
    const patch = await added;
    expect(patch.map?.scenes[0]?.fog.revealed ?? []).toEqual([]);

    gmClient.close();
    player.client.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @daggerheart/server test`
Expected: FAIL — the first new test times out waiting for a fog reveal that
never happens (auto mode isn't wired up yet). The second test should
already pass (nothing reveals fog in manual mode via `addToken` today) —
confirming it now, before Step 3, guards against a regression once Step 3
lands.

- [ ] **Step 3: Implement the auto-reveal**

In `packages/protocol/src/room.ts`, add `cellsInPolygon` to the existing
import from `./map.js`, and import `computeVisionPolygon` from the new
`./vision.js`:

```ts
import {
  MapStateSchema,
  cellsInBrush,
  cellsInPolygon,
  createMapState,
  createScene,
  fitFogToImage,
  hide,
  mapForPlayer,
  reveal,
  type MapState,
  type Scene,
  type Token,
} from './map.js';
```

(add the `cellsInPolygon,` line into the existing alphabetized list) and add
a new import line right after it:

```ts
import { computeVisionPolygon } from './vision.js';
```

Add a small helper right above `applyRoomEvent`'s definition (or anywhere
above its first use — module scope), reusable by both `addToken` and
`moveToken`:

```ts
/** When a scene auto-computes vision, reveals the fog cells a `pc` token at
 * (x, y) can see. A no-op in manual mode or for non-pc tokens. */
function revealVisionFor(scene: Scene, token: Token, x: number, y: number): Scene {
  if (scene.visionMode !== 'auto' || token.kind !== 'pc') return scene;
  const bounds = scene.image ?? { width: 0, height: 0 };
  const polygon = computeVisionPolygon({ x, y }, token.visionRadius, scene.walls, bounds);
  return { ...scene, fog: reveal(scene.fog, cellsInPolygon(scene.fog, polygon)) };
}
```

Update the `addToken` case (in the main `applyRoomEvent` switch, the one
with the player-carve-out logic) — its final line currently is:

```ts
      return ok(withScene(state, scene.id, { ...scene, tokens: [...scene.tokens, event.token] }));
```

Change it to reveal vision for the newly-placed token before returning:

```ts
      const withToken = { ...scene, tokens: [...scene.tokens, event.token] };
      return ok(withScene(state, scene.id, revealVisionFor(withToken, event.token, event.token.x, event.token.y)));
```

Update the `moveToken` case similarly — its final `return ok(...)` currently
is:

```ts
      return ok(
        withScene(state, scene.id, {
          ...scene,
          tokens: scene.tokens.map((t) =>
            t.id === token.id ? { ...t, x: event.x, y: event.y } : t,
          ),
        }),
      );
```

Change it to:

```ts
      const moved = {
        ...scene,
        tokens: scene.tokens.map((t) => (t.id === token.id ? { ...t, x: event.x, y: event.y } : t)),
      };
      return ok(withScene(state, scene.id, revealVisionFor(moved, token, event.x, event.y)));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @daggerheart/server test`
Expected: PASS — both new tests, and every pre-existing `map.test.ts` case
(moving/adding tokens in manual-mode scenes is unaffected, since
`revealVisionFor` is a no-op there).

Run: `pnpm -r typecheck`
Expected: PASS across every package.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/room.ts apps/server/test/map.test.ts
git commit -m "feat(protocol): auto-reveal fog from token vision in visionMode 'auto'"
```

---

### Task 6: GM walls panel — draw tool, door toggle, vision-mode switch

**Files:**
- Modify: `apps/web/src/components/map/MapCanvas.tsx`
- Modify: `apps/web/src/routes/MapRoute.tsx`
- Modify: `apps/web/src/styles/canvasTokens.ts`
- Modify: `apps/web/src/styles/app.css`

**Interfaces:**
- Consumes: `Wall`, `WallKind` types, `addWall`/`removeWall`/`updateWall`/
  `setSceneVisionMode` events (Task 4), `scene.walls`/`scene.visionMode`
  (Task 1) — `scene.walls` for a player is already `[]` (stripped server-
  side in Task 1), so no client-side "hide from players" logic is needed
  anywhere in this task; rendering `scene.walls` unconditionally is correct
  for both roles.
- Produces: a `drawingWall: boolean` + `onAddWall(x1, y1, x2, y2): void`
  pair of new `MapCanvasProps`, following the exact same shape as the
  already-existing `measuring: boolean` prop (no new state-management
  pattern introduced).

- [ ] **Step 1: Add wall colors to the canvas palette**

In `apps/web/src/styles/canvasTokens.ts`, add two entries to the existing
`canvasPalette` object (after `ringFallback`):

```ts
  wallLine: () => token('--c-text'),
  doorLine: () => token('--c-brass'),
```

- [ ] **Step 2: Add drawing state and rendering to `MapCanvas`**

In `apps/web/src/components/map/MapCanvas.tsx`, add to `MapCanvasProps`
(after the existing `measuring: boolean;` line):

```ts
  /** Set while the GM is placing a wall; a drag then draws a segment instead
   * of panning, same interaction shape as `measuring`. */
  drawingWall: boolean;
  onAddWall: (x1: number, y1: number, x2: number, y2: number) => void;
```

Destructure the two new props in the component's parameter list (after
`measuring,`):

```ts
  drawingWall,
  onAddWall,
```

Add wall-draft state next to the existing `measureLine` state:

```ts
  const [wallDraft, setWallDraft] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
```

In `onStagePointerDown`, add a `drawingWall` branch — insert it right before
the existing `if (measuring) { ... }` branch:

```ts
    if (drawingWall) {
      setWallDraft({ from: point, to: point });
      return;
    }
```

In `onStagePointerMove`, extend the existing `if (measureLine !== null)
setMeasureLine(...)` line to also update the wall draft:

```ts
    if (measureLine !== null) setMeasureLine({ ...measureLine, to: point });
    if (wallDraft !== null) setWallDraft({ ...wallDraft, to: point });
```

Update the `Stage`'s `draggable` and `onPointerUp` props. Currently:

```tsx
      draggable={!painting && !measuring}
      ...
      onPointerUp={() => setMeasureLine(null)}
```

Change to:

```tsx
      draggable={!painting && !measuring && !drawingWall}
      ...
      onPointerUp={() => {
        setMeasureLine(null);
        if (wallDraft !== null) {
          onAddWall(wallDraft.from.x, wallDraft.from.y, wallDraft.to.x, wallDraft.to.y);
          setWallDraft(null);
        }
      }}
```

Add a walls-rendering `Layer` — place it right after the existing grid
`Layer` (the one containing `<GridLines .../>`), before the range-rings
`Layer`:

```tsx
      <Layer listening={false}>
        {scene.walls.map((wall) => (
          <Line
            key={wall.id}
            points={[wall.x1, wall.y1, wall.x2, wall.y2]}
            stroke={wall.kind === 'door' ? canvasPalette.doorLine() : canvasPalette.wallLine()}
            strokeWidth={wall.kind === 'door' && wall.open ? 1 : 3}
            dash={wall.kind === 'door' ? [10, 6] : undefined}
            opacity={wall.kind === 'door' && wall.open ? 0.4 : 1}
          />
        ))}
        {wallDraft !== null ? (
          <Line
            points={[wallDraft.from.x, wallDraft.from.y, wallDraft.to.x, wallDraft.to.y]}
            stroke={canvasPalette.wallLine()}
            strokeWidth={3}
            dash={[4, 4]}
          />
        ) : null}
      </Layer>
```

- [ ] **Step 3: Add the walls panel to `MapRoute`**

In `apps/web/src/routes/MapRoute.tsx`, add `'walls'` to the `PanelId` union,
`PANEL_TITLES`, and `defaultPanels()` (following the exact pattern of every
existing entry):

```ts
type PanelId = 'scenes' | 'battlemap' | 'grid' | 'tokens' | 'fog' | 'sheet' | 'walls';

const PANEL_TITLES: Record<PanelId, string> = {
  scenes: 'Escenas',
  battlemap: 'Mapa de batalla',
  grid: 'Cuadrícula y escala',
  tokens: 'Fichas',
  fog: 'Niebla de guerra',
  sheet: 'Hoja de personaje',
  walls: 'Muros y puertas',
};
```

```ts
const defaultPanels = (): PanelStore => ({
  scenes: { x: 90, y: 96, z: 1, open: false },
  battlemap: { x: 90, y: 96, z: 1, open: false },
  grid: { x: 90, y: 96, z: 1, open: false },
  tokens: { x: 90, y: 96, z: 1, open: true },
  fog: { x: 90, y: 96, z: 1, open: false },
  sheet: { x: 90, y: 96, z: 1, open: false },
  walls: { x: 90, y: 96, z: 1, open: false },
});
```

Add a rail button next to the existing fog toggle (in the GM `<>` block of
the rail, right after `{toolButton('fog', '🌫', 'Niebla de guerra')}`):

```tsx
              {toolButton('walls', '🚪', 'Muros y puertas')}
```

Add `drawingWall` state next to `measuring`:

```ts
  const [drawingWall, setDrawingWall] = useState(false);
```

Wire the two new `MapCanvas` props onto the existing `<MapCanvas>` element
(next to the existing `measuring={measuring}` line):

```tsx
            drawingWall={drawingWall}
            onAddWall={(x1, y1, x2, y2) => {
              if (scene === null) return;
              send({
                type: 'addWall',
                sceneId: scene.id,
                wall: { id: nextId('wall'), x1, y1, x2, y2, kind: 'wall', open: false },
              });
            }}
```

Add the walls panel — place it right after the existing fog panel's closing
`</FloatingPanel>` (before the outer `</div>` that closes `.map-fullscreen`):

```tsx
      {isGameMaster && scene !== null && panels.walls.open ? (
        <FloatingPanel
          title={PANEL_TITLES.walls}
          layout={panels.walls}
          onLayoutChange={(l) => movePanel('walls', l)}
          onFocus={() => focusPanel('walls')}
          onClose={() => closePanel('walls')}
        >
          <button type="button" aria-pressed={drawingWall} onClick={() => setDrawingWall((d) => !d)}>
            {drawingWall ? 'Dibujando muro…' : 'Dibujar muro'}
          </button>
          <p className="muted mt-2">
            {scene.visionMode === 'auto'
              ? 'Visión automática: la niebla se revela sola según lo que cada PJ puede ver.'
              : 'Niebla manual: usa el pincel del panel de niebla.'}
          </p>
          <button
            type="button"
            className="mt-2"
            onClick={() =>
              send({
                type: 'setSceneVisionMode',
                sceneId: scene.id,
                visionMode: scene.visionMode === 'auto' ? 'manual' : 'auto',
              })
            }
          >
            Cambiar a {scene.visionMode === 'auto' ? 'manual' : 'automática'}
          </button>

          {scene.walls.length === 0 ? (
            <p className="muted mt-3">Todavía no hay muros en esta escena.</p>
          ) : (
            <ul className="log mt-3">
              {scene.walls.map((wall) => (
                <li key={wall.id}>
                  <div className="row spread">
                    <span>{wall.kind === 'door' ? 'Puerta' : 'Muro'}</span>
                    <div className="row">
                      {wall.kind === 'door' ? (
                        <button
                          type="button"
                          onClick={() =>
                            send({ type: 'updateWall', sceneId: scene.id, wall: { ...wall, open: !wall.open } })
                          }
                        >
                          {wall.open ? 'Abierta' : 'Cerrada'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            send({ type: 'updateWall', sceneId: scene.id, wall: { ...wall, kind: 'door' } })
                          }
                        >
                          Convertir en puerta
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => send({ type: 'removeWall', sceneId: scene.id, wallId: wall.id })}
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </FloatingPanel>
      ) : null}
```

- [ ] **Step 4: Hide the manual fog brush in auto mode**

In the existing fog panel's JSX (the `{isGameMaster && scene !== null &&
panels.fog.open ? (...)}` block), wrap the manual-paint controls (the
enable-toggle button and the reveal/hide brush buttons) so they only show in
manual mode, and add a note in auto mode. The existing block currently
renders those controls unconditionally then a closing muted paragraph —
change it to:

```tsx
          {scene.visionMode === 'manual' ? (
            <>
              <button
                type="button"
                aria-pressed={scene.fog.enabled}
                onClick={() => send({ type: 'setFogEnabled', sceneId: scene.id, enabled: !scene.fog.enabled })}
              >
                {scene.fog.enabled ? 'Niebla activada' : 'Niebla desactivada'}
              </button>
              <div className="row mt-3">
                <button
                  type="button"
                  aria-pressed={fogBrush?.reveal === true}
                  onClick={() => setFogBrush(fogBrush?.reveal === true ? null : { radius: 120, reveal: true })}
                >
                  Pincel de revelar
                </button>
                <button
                  type="button"
                  aria-pressed={fogBrush?.reveal === false}
                  onClick={() => setFogBrush(fogBrush?.reveal === false ? null : { radius: 120, reveal: false })}
                >
                  Pincel de ocultar
                </button>
              </div>
              <p className="muted">Los jugadores solo ven las áreas reveladas — el resto nunca se les envía.</p>
            </>
          ) : (
            <p className="muted">
              Visión automática activa (panel "Muros y puertas") — el pincel manual está desactivado para esta
              escena.
            </p>
          )}
```

- [ ] **Step 5: Verify manually**

Run `pnpm -F @daggerheart/web typecheck` — expect PASS.
Run `pnpm -F @daggerheart/web test` — expect PASS (no existing test touches
these panels' internals, so this is a regression check, not new coverage —
Konva-rendered canvas content isn't unit-testable here, same constraint
already hit with `snapToGrid`/`gridSnap.ts`).

Manually verify with `pnpm dev` (or `docker compose up -d --build`): open the
map as GM, open "Muros y puertas", click "Dibujar muro", drag a line on the
canvas, release — the wall appears in the list and on the canvas. Toggle it
to a door, toggle open/closed, delete it. Switch a scene to automatic vision,
add/move a PC token, confirm fog reveals around it without touching the
brush; confirm the fog panel's manual controls are hidden while auto mode is
on.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/map/MapCanvas.tsx apps/web/src/routes/MapRoute.tsx \
  apps/web/src/styles/canvasTokens.ts apps/web/src/styles/app.css
git commit -m "feat(web): GM walls/doors panel, draw tool, vision-mode switch"
```

---

## After all tasks

Run the full workspace check before considering the feature done:

```bash
pnpm -r typecheck && pnpm -r test
```

Then rebuild and verify the running container:

```bash
docker compose up -d --build
curl -s http://localhost:4000/health
```
