import { describe, expect, it } from 'vitest';

import {
  bandForFeet,
  bandForSquares,
  DEFAULT_SCALE,
  measure,
  ringRadii,
  ringRadius,
  type RangeScale,
} from '../src/index.js';

const grid: RangeScale = { mode: 'square', pixelsPerSquare: 50, feetPerInch: 5 };
const gridless: RangeScale = { mode: 'none', pixelsPerSquare: 50, feetPerInch: 5 };

describe('grid mode (SRD optional rule: 1 / 3 / 6 / 12 / 13+ squares)', () => {
  it('maps square counts to the SRD bands', () => {
    expect(bandForSquares(0)).toBe('melee');
    expect(bandForSquares(1)).toBe('melee');
    expect(bandForSquares(2)).toBe('veryClose');
    expect(bandForSquares(3)).toBe('veryClose');
    expect(bandForSquares(4)).toBe('close');
    expect(bandForSquares(6)).toBe('close');
    expect(bandForSquares(7)).toBe('far');
    expect(bandForSquares(12)).toBe('far');
    // "Very Far: 13+ squares" has no upper bound on the battlemap.
    expect(bandForSquares(13)).toBe('veryFar');
    expect(bandForSquares(40)).toBe('veryFar');
  });

  it('measures between two points in whole squares', () => {
    const origin = { x: 0, y: 0 };

    // One square away.
    expect(measure(origin, { x: 50, y: 0 }, grid)).toMatchObject({ squares: 1, band: 'melee' });
    // Three squares away.
    expect(measure(origin, { x: 150, y: 0 }, grid)).toMatchObject({
      squares: 3,
      band: 'veryClose',
    });
    // Six squares.
    expect(measure(origin, { x: 300, y: 0 }, grid)).toMatchObject({ squares: 6, band: 'close' });
    // Twelve squares.
    expect(measure(origin, { x: 600, y: 0 }, grid)).toMatchObject({ squares: 12, band: 'far' });
    // Thirteen squares.
    expect(measure(origin, { x: 650, y: 0 }, grid)).toMatchObject({ squares: 13, band: 'veryFar' });
  });

  it('counts a part-square as a whole one', () => {
    // 1.4 squares of separation still costs two squares of movement.
    expect(measure({ x: 0, y: 0 }, { x: 70, y: 0 }, grid).squares).toBe(2);
  });

  it('measures diagonally, not just along an axis', () => {
    // A 3-4-5 triangle: 150,200 is 250px away, five squares.
    const result = measure({ x: 0, y: 0 }, { x: 150, y: 200 }, grid);
    expect(result.pixels).toBeCloseTo(250);
    expect(result.squares).toBe(5);
    expect(result.band).toBe('close');
  });

  it('reports no feet in grid mode', () => {
    expect(measure({ x: 0, y: 0 }, { x: 50, y: 0 }, grid).feet).toBeNull();
  });
});

describe('gridless mode (SRD feet bands, 1 inch = 5 feet)', () => {
  it('maps distances in feet to the SRD bands', () => {
    expect(bandForFeet(0)).toBe('melee');
    expect(bandForFeet(5)).toBe('melee');
    expect(bandForFeet(6)).toBe('veryClose');
    expect(bandForFeet(10)).toBe('veryClose');
    expect(bandForFeet(11)).toBe('close');
    expect(bandForFeet(30)).toBe('close');
    expect(bandForFeet(31)).toBe('far');
    expect(bandForFeet(100)).toBe('far');
    expect(bandForFeet(101)).toBe('veryFar');
    expect(bandForFeet(300)).toBe('veryFar');
    // Anything beyond Very Far can't usually be targeted.
    expect(bandForFeet(301)).toBe('outOfRange');
  });

  it('converts pixels to feet through the inch scale', () => {
    // 50px = 1 inch = 5 feet.
    expect(measure({ x: 0, y: 0 }, { x: 50, y: 0 }, gridless)).toMatchObject({
      feet: 5,
      band: 'melee',
    });
    expect(measure({ x: 0, y: 0 }, { x: 100, y: 0 }, gridless)).toMatchObject({
      feet: 10,
      band: 'veryClose',
    });
    expect(measure({ x: 0, y: 0 }, { x: 300, y: 0 }, gridless)).toMatchObject({
      feet: 30,
      band: 'close',
    });
    expect(measure({ x: 0, y: 0 }, { x: 1000, y: 0 }, gridless)).toMatchObject({
      feet: 100,
      band: 'far',
    });
    expect(measure({ x: 0, y: 0 }, { x: 3000, y: 0 }, gridless)).toMatchObject({
      feet: 300,
      band: 'veryFar',
    });
    expect(measure({ x: 0, y: 0 }, { x: 3050, y: 0 }, gridless).band).toBe('outOfRange');
  });

  it('honours a differently scaled map', () => {
    // A map drawn at 10 feet per inch halves every distance in bands.
    const coarse: RangeScale = { mode: 'none', pixelsPerSquare: 50, feetPerInch: 10 };
    expect(measure({ x: 0, y: 0 }, { x: 50, y: 0 }, coarse)).toMatchObject({
      feet: 10,
      band: 'veryClose',
    });
  });

  it('reports no squares in gridless mode', () => {
    expect(measure({ x: 0, y: 0 }, { x: 50, y: 0 }, gridless).squares).toBeNull();
  });
});

describe('range rings', () => {
  it('places grid rings at the SRD square counts', () => {
    expect(ringRadius('melee', grid)).toBe(50);
    expect(ringRadius('veryClose', grid)).toBe(150);
    expect(ringRadius('close', grid)).toBe(300);
    expect(ringRadius('far', grid)).toBe(600);
    // Very Far is "13+ squares", so it has no ring to draw.
    expect(ringRadius('veryFar', grid)).toBeNull();
  });

  it('places gridless rings at the SRD feet bounds', () => {
    expect(ringRadius('melee', gridless)).toBe(50);
    expect(ringRadius('veryClose', gridless)).toBe(100);
    expect(ringRadius('close', gridless)).toBe(300);
    expect(ringRadius('far', gridless)).toBe(1000);
    expect(ringRadius('veryFar', gridless)).toBe(3000);
  });

  it('returns rings outermost first so they layer correctly', () => {
    const rings = ringRadii(gridless);
    expect(rings.map((r) => r.band)).toEqual(['veryFar', 'far', 'close', 'veryClose', 'melee']);
    expect(rings[0]?.radius).toBeGreaterThan(rings[1]?.radius ?? 0);
  });

  it('omits the unbounded Very Far ring on a grid', () => {
    expect(ringRadii(grid).map((r) => r.band)).toEqual(['far', 'close', 'veryClose', 'melee']);
  });

  it('has no ring for Out of Range', () => {
    expect(ringRadius('outOfRange', gridless)).toBeNull();
  });
});

describe('defaults', () => {
  it('starts gridless at 50px per inch and 5 feet per inch', () => {
    expect(DEFAULT_SCALE).toEqual({ mode: 'none', pixelsPerSquare: 50, feetPerInch: 5 });
  });
});
