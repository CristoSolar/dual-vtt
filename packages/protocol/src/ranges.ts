import { z } from 'zod';

/**
 * Daggerheart's ranges are relative bands, not distances (SRD p.40). This module
 * converts a measured distance on a map into the band the table should use.
 *
 * It is pure and has no canvas dependency: the map components ask it, they never
 * work distances out themselves.
 */

export const RangeBandSchema = z.enum([
  'melee',
  'veryClose',
  'close',
  'far',
  'veryFar',
  'outOfRange',
]);
export type RangeBand = z.infer<typeof RangeBandSchema>;

/** Display names, in the order the SRD lists them. */
export const RANGE_BANDS: readonly RangeBand[] = [
  'melee',
  'veryClose',
  'close',
  'far',
  'veryFar',
];

export const RANGE_LABELS: Record<RangeBand, string> = {
  melee: 'Melee',
  veryClose: 'Very Close',
  close: 'Close',
  far: 'Far',
  veryFar: 'Very Far',
  outOfRange: 'Out of Range',
};

/**
 * Optional grid rule (SRD p.40): with a 1-inch grid, each band has a square count.
 * These are inclusive upper bounds; Very Far is "13+ squares", so anything past Far
 * is Very Far until it leaves the battlemap entirely.
 */
export const GRID_SQUARES: Record<'melee' | 'veryClose' | 'close' | 'far', number> = {
  melee: 1,
  veryClose: 3,
  close: 6,
  far: 12,
};

/**
 * Gridless play (SRD p.40): the bands are described in feet, and one inch of map
 * represents about five feet of fiction.
 *
 * The SRD's figures overlap ("about 5-10 feet", "about 10-30 feet"), so each bound
 * below is treated as inclusive and the next band starts above it. Melee is "up to a
 * few feet", which is everything below where Very Close begins.
 */
export const FEET_BOUNDS: Record<'melee' | 'veryClose' | 'close' | 'far' | 'veryFar', number> = {
  melee: 5,
  veryClose: 10,
  close: 30,
  far: 100,
  veryFar: 300,
};

/** One inch of map is about five feet of fiction (SRD p.40). */
export const FEET_PER_INCH = 5;

export const GridModeSchema = z.enum(['none', 'square']);
export type GridMode = z.infer<typeof GridModeSchema>;

export interface RangeScale {
  mode: GridMode;
  /**
   * Map pixels per grid square, used in 'square' mode. Also the assumed pixels per
   * inch in 'none' mode, since the SRD's gridless guidance is stated per inch.
   */
  pixelsPerSquare: number;
  /** Feet represented by one inch of map. Adjustable for a differently scaled map. */
  feetPerInch: number;
}

export const DEFAULT_SCALE: RangeScale = {
  mode: 'none',
  pixelsPerSquare: 50,
  feetPerInch: FEET_PER_INCH,
};

/** Straight-line distance between two points, in map pixels. */
export function distanceInPixels(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** The band a distance in grid squares falls into (SRD p.40, optional grid rule). */
export function bandForSquares(squares: number): RangeBand {
  if (squares <= GRID_SQUARES.melee) return 'melee';
  if (squares <= GRID_SQUARES.veryClose) return 'veryClose';
  if (squares <= GRID_SQUARES.close) return 'close';
  if (squares <= GRID_SQUARES.far) return 'far';
  // "Very Far: 13+ squares" — off the battlemap is Out of Range, which the caller
  // decides from the scene bounds rather than the distance alone.
  return 'veryFar';
}

/** The band a distance in feet falls into (SRD p.40). */
export function bandForFeet(feet: number): RangeBand {
  if (feet <= FEET_BOUNDS.melee) return 'melee';
  if (feet <= FEET_BOUNDS.veryClose) return 'veryClose';
  if (feet <= FEET_BOUNDS.close) return 'close';
  if (feet <= FEET_BOUNDS.far) return 'far';
  if (feet <= FEET_BOUNDS.veryFar) return 'veryFar';
  return 'outOfRange';
}

export interface Measurement {
  band: RangeBand;
  label: string;
  pixels: number;
  /** Distance in grid squares, in 'square' mode. */
  squares: number | null;
  /** Distance in feet, in 'none' mode. */
  feet: number | null;
}

/** Measures between two points on a scene and returns the Daggerheart band. */
export function measure(
  a: { x: number; y: number },
  b: { x: number; y: number },
  scale: RangeScale,
): Measurement {
  const pixels = distanceInPixels(a, b);
  const units = scale.pixelsPerSquare > 0 ? pixels / scale.pixelsPerSquare : 0;

  if (scale.mode === 'square') {
    // Movement on a grid is counted in whole squares.
    const squares = Math.ceil(units);
    const band = bandForSquares(squares);
    return { band, label: RANGE_LABELS[band], pixels, squares, feet: null };
  }

  const feet = units * scale.feetPerInch;
  const band = bandForFeet(feet);
  return { band, label: RANGE_LABELS[band], pixels, squares: null, feet };
}

/**
 * The radius in map pixels at which each band ends, for drawing range rings around a
 * token. Returns null for a band that has no finite outer edge in this mode.
 */
export function ringRadius(band: RangeBand, scale: RangeScale): number | null {
  if (band === 'outOfRange') return null;

  if (scale.mode === 'square') {
    if (band === 'veryFar') return null; // "13+ squares" has no upper bound.
    return GRID_SQUARES[band] * scale.pixelsPerSquare;
  }

  const feet = FEET_BOUNDS[band];
  const inches = feet / scale.feetPerInch;
  return inches * scale.pixelsPerSquare;
}

/** Every drawable ring for a token, outermost band first so they layer correctly. */
export function ringRadii(scale: RangeScale): { band: RangeBand; radius: number }[] {
  return RANGE_BANDS.map((band) => ({ band, radius: ringRadius(band, scale) }))
    .filter((ring): ring is { band: RangeBand; radius: number } => ring.radius !== null)
    .sort((a, b) => b.radius - a.radius);
}
