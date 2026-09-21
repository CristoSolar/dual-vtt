import { rollDie, type Rng } from './rng.js';

/**
 * The optional hazards the GM adjudicates (SRD 2.0 p.92).
 *
 * These are guides rather than rules the SRD enforces, so every function here
 * returns a number for the GM to use or ignore. The ranges are the printed ones.
 */

/** How far a character fell, which is what sets the damage. */
export type FallRange = 'veryClose' | 'close' | 'farOrVeryFar';

/** The printed fall damage per range, as dice plus a flat bonus. */
export const FALL_DAMAGE: Record<FallRange, { count: number; die: number; modifier: number }> = {
  veryClose: { count: 1, die: 10, modifier: 3 },
  close: { count: 1, die: 20, modifier: 5 },
  farOrVeryFar: { count: 1, die: 100, modifier: 15 },
};

/**
 * A fall. From Far or Very Far the SRD also allows outright death at the GM's
 * discretion, which is a call no function should make, so this only rolls.
 */
export function rollFallDamage(range: FallRange, rng: Rng): number {
  const { count, die, modifier } = FALL_DAMAGE[range];
  let total = modifier;
  for (let i = 0; i < count; i++) total += rollDie(die, rng);
  return total;
}

/**
 * Colliding with an object or another character at a dangerous speed: 1d20+5, and
 * direct, so Armor Slots do not reduce it.
 */
export function rollCollisionDamage(rng: Rng): number {
  return rollDie(20, rng) + 5;
}

/** How long a creature that cannot breathe underwater can hold its breath. */
export const HOLD_BREATH_COUNTDOWN = 3;

/**
 * A fate roll: one Duality die, read however the GM said it would be read before
 * it was rolled (SRD 2.0 p.92).
 */
export function rollFate(rng: Rng): number {
  return rollDie(12, rng);
}
