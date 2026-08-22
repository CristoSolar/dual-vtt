import { z } from 'zod';

import { GridModeSchema } from './ranges.js';

/**
 * The map slice of a room: a set of scenes, one of which is active.
 *
 * Everything here is plain JSON. Fog is stored as a coarse grid of revealed cell
 * indices rather than a bitmap, so a reveal costs a handful of numbers instead of a
 * full-resolution image on every update.
 */

export const TokenKindSchema = z.enum([
  /** Bound to a character in the room. */
  'pc',
  /** Bound to an adversary instance in the room's roster. */
  'adversary',
  /** A plain labelled marker: an object, a hazard, an NPC with no stat block. */
  'marker',
]);
export type TokenKind = z.infer<typeof TokenKindSchema>;

export const SceneImageSchema = z.object({
  /** Path served by the server, e.g. "/uploads/abc123.png". */
  url: z.string().min(1).max(512),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
});
export type SceneImage = z.infer<typeof SceneImageSchema>;

export const TokenSchema = z.object({
  id: z.string().min(1).max(64),
  kind: TokenKindSchema,
  /** Character id or adversary instance id, depending on `kind`. Null for markers. */
  refId: z.string().min(1).max(64).nullable(),
  name: z.string().min(1).max(60),
  x: z.number(),
  y: z.number(),
  width: z.number().positive().max(4000),
  height: z.number().positive().max(4000),
  rotation: z.number().min(-360).max(360),
  /**
   * The player account id allowed to drag this token. Null means GM-only. The
   * server checks this; a client cannot move a token it does not own.
   */
  ownerId: z.string().min(1).max(64).nullable(),
  /** GM-only tokens are stripped from the state players receive. */
  hidden: z.boolean(),
  /** Whether to draw the Daggerheart range rings around this token. */
  showRings: z.boolean(),
  color: z.string().min(1).max(24),
  /** A token portrait, if the GM/player attached one. Falls back to `color`. */
  image: SceneImageSchema.nullable(),
  /**
   * Draws `color` as a ring around the portrait — lets the GM tell apart
   * several tokens sharing the same sprite. Meaningless without `image`.
   */
  colorFrame: z.boolean().default(false),
  /** Pixels a `pc` token can see in `visionMode: 'auto'`. Ignored otherwise. */
  visionRadius: z.number().min(0).max(4000).default(720),
});
export type Token = z.infer<typeof TokenSchema>;

/**
 * Fog of war over a scene, as a coarse cell grid. `revealed` holds the indices of
 * cells the players can see; every other cell is simply absent, so an unrevealed
 * region never reaches a player's client at all.
 */
export const FogSchema = z.object({
  enabled: z.boolean(),
  /** Size of one fog cell in map pixels. Larger is coarser and cheaper. */
  cellSize: z.number().int().min(10).max(500),
  cols: z.number().int().min(0).max(1000),
  rows: z.number().int().min(0).max(1000),
  /** Sorted, de-duplicated cell indices that are revealed. */
  revealed: z.array(z.number().int().nonnegative()).max(200_000),
});
export type Fog = z.infer<typeof FogSchema>;

export const GridSchema = z.object({
  mode: GridModeSchema,
  /** Pixels per square, and the assumed pixels-per-inch when measuring gridless. */
  size: z.number().min(5).max(500),
  offsetX: z.number().min(-500).max(500),
  offsetY: z.number().min(-500).max(500),
  /** Feet represented by one inch of map (SRD p.40 assumes 5). */
  feetPerInch: z.number().min(1).max(100),
  /** Line color, as a CSS color string (e.g. "#f2ece1"). */
  color: z.string().min(1).max(24).default('#5c5470'),
  /** Line thickness in pixels. */
  lineWidth: z.number().min(1).max(10).default(1),
});
export type Grid = z.infer<typeof GridSchema>;

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

export const MapStateSchema = z.object({
  scenes: z.array(SceneSchema).max(50),
  /** Only the active scene is broadcast to players. */
  activeSceneId: z.string().min(1).max(64).nullable(),
});
export type MapState = z.infer<typeof MapStateSchema>;

export const DEFAULT_GRID: Grid = {
  mode: 'none',
  size: 50,
  offsetX: 0,
  offsetY: 0,
  feetPerInch: 5,
  color: '#5c5470',
  lineWidth: 1,
};
export const DEFAULT_FOG: Fog = { enabled: false, cellSize: 50, cols: 0, rows: 0, revealed: [] };

export function createMapState(): MapState {
  return { scenes: [], activeSceneId: null };
}

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

// --- fog helpers -------------------------------------------------------------

/** Fits the fog grid to an image, preserving whatever was already revealed. */
export function fitFogToImage(fog: Fog, image: SceneImage | null): Fog {
  if (image === null) return fog;
  return {
    ...fog,
    cols: Math.ceil(image.width / fog.cellSize),
    rows: Math.ceil(image.height / fog.cellSize),
  };
}

/** The fog cell indices a circular brush stroke covers. */
export function cellsInBrush(
  fog: Fog,
  centre: { x: number; y: number },
  radius: number,
): number[] {
  if (fog.cols === 0 || fog.rows === 0) return [];

  const cells: number[] = [];
  const minCol = Math.max(0, Math.floor((centre.x - radius) / fog.cellSize));
  const maxCol = Math.min(fog.cols - 1, Math.floor((centre.x + radius) / fog.cellSize));
  const minRow = Math.max(0, Math.floor((centre.y - radius) / fog.cellSize));
  const maxRow = Math.min(fog.rows - 1, Math.floor((centre.y + radius) / fog.cellSize));

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      // A cell counts as brushed when its centre falls inside the stroke.
      const cx = col * fog.cellSize + fog.cellSize / 2;
      const cy = row * fog.cellSize + fog.cellSize / 2;
      if (Math.hypot(cx - centre.x, cy - centre.y) <= radius) cells.push(row * fog.cols + col);
    }
  }
  return cells;
}

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

/** Adds cells to the revealed set, keeping it sorted and free of duplicates. */
export function reveal(fog: Fog, cells: readonly number[]): Fog {
  if (cells.length === 0) return fog;
  const next = new Set(fog.revealed);
  for (const cell of cells) next.add(cell);
  return { ...fog, revealed: [...next].sort((a, b) => a - b) };
}

/** Removes cells from the revealed set, hiding them again. */
export function hide(fog: Fog, cells: readonly number[]): Fog {
  if (cells.length === 0) return fog;
  const remove = new Set(cells);
  return { ...fog, revealed: fog.revealed.filter((cell) => !remove.has(cell)) };
}

/** True when a point is inside a revealed cell. */
export function isRevealed(fog: Fog, point: { x: number; y: number }): boolean {
  if (!fog.enabled) return true;
  if (fog.cols === 0) return false;
  const col = Math.floor(point.x / fog.cellSize);
  const row = Math.floor(point.y / fog.cellSize);
  if (col < 0 || row < 0 || col >= fog.cols || row >= fog.rows) return false;
  return fog.revealed.includes(row * fog.cols + col);
}

// --- role-based views --------------------------------------------------------

/**
 * What a player is allowed to see of the map: the active scene only, without
 * GM-only tokens. Unrevealed fog is absent by construction — `revealed` lists what
 * players can see, so hidden regions are never transmitted.
 */
export function mapForPlayer(map: MapState): MapState {
  const active = map.scenes.find((scene) => scene.id === map.activeSceneId);
  if (active === undefined) return { scenes: [], activeSceneId: null };

  return {
    activeSceneId: map.activeSceneId,
    scenes: [{ ...active, tokens: active.tokens.filter((token) => !token.hidden), walls: [] }],
  };
}
