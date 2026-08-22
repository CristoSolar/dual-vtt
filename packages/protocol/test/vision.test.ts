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

  it('returns vertices in monotonically increasing angular order (no self-intersection)', () => {
    // This wall has a corner "north" of the origin (dy < 0), which produces a
    // negative atan2 angle representing a true direction late in the sweep
    // (~297°). If corner angles and fallback angles aren't normalized into a
    // consistent range before sorting, this corner sorts to the front of the
    // array instead of near the end, producing a self-intersecting polygon.
    const origin = { x: 500, y: 500 };
    const blocker = wall({ x1: 550, y1: 400, x2: 550, y2: 600 });
    const polygon = computeVisionPolygon(origin, 200, [blocker], bounds);

    const normalize = (a: number) => (a < 0 ? a + 2 * Math.PI : a);
    const angles = polygon.map((p) => normalize(Math.atan2(p.y - origin.y, p.x - origin.x)));

    const EPS = 1e-9;
    for (let i = 1; i < angles.length; i++) {
      const current = angles[i];
      const previous = angles[i - 1];
      expect(current).toBeDefined();
      expect(previous).toBeDefined();
      expect(current! - previous!).toBeGreaterThanOrEqual(-EPS);
    }
  });

  it('exits through the true ray/box intersection near a scene corner, not per-axis clamping', () => {
    // Origin near the top-left corner of a small scene, radius much larger
    // than the distance to the corner. A ray aimed diagonally between the two
    // edges should be clipped exactly where it crosses whichever edge it hits
    // first, not clamped independently on each axis (which would distort the
    // point away from the ray's actual direction).
    const origin = { x: 10, y: 10 };
    const smallBounds = { width: 200, height: 200 };

    // Force an exact ray at this angle by planting a degenerate (zero-length)
    // "wall" whose corner sits far away along the desired direction, well
    // outside both the radius and the bounds. A zero-length wall never
    // blocks anything (its direction vector is zero, so the intersection
    // math treats it as parallel/no-op) but its corner still contributes an
    // exact angle to the ray-casting sweep.
    const angle = Math.atan2(150, 190); // aimed above the 45-degree diagonal: should hit the right edge first
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const farX = origin.x + dirX * 1000;
    const farY = origin.y + dirY * 1000;
    const marker = wall({ x1: farX, y1: farY, x2: farX, y2: farY });

    const polygon = computeVisionPolygon(origin, 500, [marker], smallBounds);

    const normalize = (a: number) => (a < 0 ? a + 2 * Math.PI : a);
    const targetAngle = normalize(angle);
    let exact = polygon.find(
      (p) => Math.abs(normalize(Math.atan2(p.y - origin.y, p.x - origin.x)) - targetAngle) < 1e-6,
    );
    expect(exact).toBeDefined();
    exact = exact!;

    // The true ray/box intersection: whichever of the x=width or y=height
    // edges is crossed first, using the same t along the ray for both axes —
    // NOT independent per-axis clamping of a point stretched out to radius
    // 500, which would land at (200, 200) here (a bogus corner point.
    const tx = (smallBounds.width - origin.x) / dirX;
    const ty = (smallBounds.height - origin.y) / dirY;
    const t = Math.min(tx, ty, 500);
    const expected = { x: origin.x + dirX * t, y: origin.y + dirY * t };

    expect(exact.x).toBeCloseTo(expected.x, 1);
    expect(exact.y).toBeCloseTo(expected.y, 1);
    // Sanity: confirm this is NOT the buggy per-axis-clamped corner point.
    expect(Math.hypot(exact.x - 200, exact.y - 200)).toBeGreaterThan(1);
  });
});
