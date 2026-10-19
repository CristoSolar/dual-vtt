import { z } from 'zod';

import type { Token } from './map.js';

/**
 * Areas the GM draws on a scene. A region marks difficult terrain, a hazard, or
 * just a note; a token walking into a hazard tells the GM what it walked into.
 */

const PointSchema = z.object({ x: z.number(), y: z.number() });
type Point = z.infer<typeof PointSchema>;

export const RegionEffectSchema = z.enum(['difficultTerrain', 'hazard', 'note']);
export type RegionEffect = z.infer<typeof RegionEffectSchema>;

export const RegionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  points: z.array(PointSchema).min(3).max(64),
  effect: RegionEffectSchema,
  /** What the GM is told on entry. Players never receive it for a hazard. */
  text: z.string().max(500),
  /** Invisible regions are stripped from what players receive. */
  visibleToPlayers: z.boolean(),
});
export type Region = z.infer<typeof RegionSchema>;

/** How many regions one scene holds. */
export const MAX_SCENE_REGIONS = 50;

/** True when `p` lies on the segment a–b, ends included. */
function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  if (Math.abs(cross) > 1e-9 * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))) return false;
  return (
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}

/**
 * Point-in-polygon by ray casting (even-odd rule). A point on the border counts as
 * inside, so a token parked exactly on a region's edge is in it.
 */
export function pointInPolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (onSegment(p, a, b)) return true;
    const crosses = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

const centreOf = (token: Token): Point => ({
  x: token.x + token.width / 2,
  y: token.y + token.height / 2,
});

/** The regions a token's centre was outside of before a move and is inside after. */
export function regionsEntered(before: Token, after: Token, regions: readonly Region[]): Region[] {
  const from = centreOf(before);
  const to = centreOf(after);
  return regions.filter(
    (region) => !pointInPolygon(from, region.points) && pointInPolygon(to, region.points),
  );
}
