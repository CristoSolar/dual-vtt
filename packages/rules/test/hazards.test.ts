import { describe, expect, it } from 'vitest';

import { seededRng } from '../src/rng.js';
import {
  FALL_DAMAGE,
  HOLD_BREATH_COUNTDOWN,
  rollCollisionDamage,
  rollFallDamage,
  rollFate,
} from '../src/hazards.js';

describe('hazards', () => {
  it('rolls a fall inside the printed bounds for its range', () => {
    const rng = seededRng(7);
    for (const range of ['veryClose', 'close', 'farOrVeryFar'] as const) {
      const { count, die, modifier } = FALL_DAMAGE[range];
      for (let i = 0; i < 50; i++) {
        const damage = rollFallDamage(range, rng);
        expect(damage).toBeGreaterThanOrEqual(count + modifier);
        expect(damage).toBeLessThanOrEqual(count * die + modifier);
      }
    }
  });

  it('rolls a collision as 1d20+5', () => {
    const rng = seededRng(11);
    for (let i = 0; i < 50; i++) {
      const damage = rollCollisionDamage(rng);
      expect(damage).toBeGreaterThanOrEqual(6);
      expect(damage).toBeLessThanOrEqual(25);
    }
  });

  it('rolls a fate roll on one Duality die', () => {
    const rng = seededRng(3);
    for (let i = 0; i < 50; i++) {
      const value = rollFate(rng);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(12);
    }
  });

  it('holds its breath for a standard countdown', () => {
    expect(HOLD_BREATH_COUNTDOWN).toBe(3);
  });
});
