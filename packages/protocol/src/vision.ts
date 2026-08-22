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

/** Normalizes an angle into `[0, 2*PI)` so every angle in the sweep — whether
 * it came from the evenly-spaced fallback rays or from `Math.atan2` (which
 * returns values in `(-PI, PI]`) — sorts correctly around a single
 * consistent direction of travel. Without this, a wall corner "north" of the
 * origin (negative atan2 angle, but a true direction late in the sweep, near
 * 2*PI) would sort to the very front of the array instead of adjacent to the
 * fallback rays it geometrically belongs next to, producing a
 * self-intersecting polygon. */
function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  const wrapped = angle % twoPi;
  return wrapped < 0 ? wrapped + twoPi : wrapped;
}

/** Nearest distance along a ray from `origin` at `angle` to the edge of the
 * scene bounds rectangle (the slab method), or `Infinity` if the ray points
 * away from the box entirely (shouldn't happen from a point at/near the box,
 * but guards against a degenerate direction vector). */
function rayIntersectsBounds(
  origin: Point,
  angle: number,
  bounds: { width: number; height: number },
): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);

  let nearest = Infinity;

  if (Math.abs(dx) > 1e-10) {
    for (const boundaryX of [0, bounds.width]) {
      const t = (boundaryX - origin.x) / dx;
      if (t > 0) nearest = Math.min(nearest, t);
    }
  }
  if (Math.abs(dy) > 1e-10) {
    for (const boundaryY of [0, bounds.height]) {
      const t = (boundaryY - origin.y) / dy;
      if (t > 0) nearest = Math.min(nearest, t);
    }
  }

  return nearest;
}

function castRay(
  origin: Point,
  angle: number,
  radius: number,
  walls: readonly Wall[],
  bounds: { width: number; height: number },
): Point {
  let nearest = Math.min(radius, rayIntersectsBounds(origin, angle, bounds));
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
      angles.add(normalizeAngle(angle - CORNER_EPSILON));
      angles.add(normalizeAngle(angle));
      angles.add(normalizeAngle(angle + CORNER_EPSILON));
    }
  }

  // Bounds clamping is now done via true ray/box intersection inside
  // castRay (see rayIntersectsBounds), so points never need post-hoc
  // per-axis clamping — the box edges are treated the same way as wall
  // segments would be, as an additional "nearest" candidate distance.
  const points = [...angles]
    .sort((a, b) => a - b)
    .map((angle) => castRay(origin, angle, radius, blockers, bounds))
    // The true ray/box intersection above already lands each point exactly
    // on (or inside) the boundary; this final clamp only guards against
    // floating-point overshoot of a few ULPs at the edge, not per-axis
    // distortion (the point was already computed from a single consistent
    // `t` for both axes).
    .map((point) => ({
      x: Math.min(Math.max(point.x, 0), bounds.width),
      y: Math.min(Math.max(point.y, 0), bounds.height),
    }));

  return points;
}
