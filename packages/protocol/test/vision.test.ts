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
