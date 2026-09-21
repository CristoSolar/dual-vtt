import { describe, expect, it } from 'vitest';

import { rollAdversaryAttack, rollAdversaryDamage, scriptedRng } from '../src/index.js';

const d20 = (face: number) => [face, 20] as const;

describe('an adversary attack', () => {
  it('is a d20 plus the stat block modifier, against Evasion', () => {
    const hit = rollAdversaryAttack({ modifier: 3, evasion: 12, rng: scriptedRng([d20(9)]) });
    expect(hit.total).toBe(12);
    expect(hit.success).toBe(true);

    const miss = rollAdversaryAttack({ modifier: 3, evasion: 13, rng: scriptedRng([d20(9)]) });
    expect(miss.success).toBe(false);
  });

  it('leaves the outcome open when no Evasion is given', () => {
    const roll = rollAdversaryAttack({ modifier: 2, rng: scriptedRng([d20(9)]) });
    expect(roll.success).toBeNull();
    expect(roll.total).toBe(11);
  });

  it('keeps the higher of two dice with advantage, the lower with disadvantage', () => {
    const good = rollAdversaryAttack({
      modifier: 0,
      advantage: true,
      rng: scriptedRng([d20(4), d20(17)]),
    });
    expect(good.dice).toEqual([4, 17]);
    expect(good.die).toBe(17);

    const bad = rollAdversaryAttack({
      modifier: 0,
      disadvantage: true,
      rng: scriptedRng([d20(4), d20(17)]),
    });
    expect(bad.die).toBe(4);
  });

  it('rolls one die when advantage and disadvantage cancel', () => {
    // Only one face is scripted, so a second roll would throw.
    const roll = rollAdversaryAttack({
      modifier: 0,
      advantage: true,
      disadvantage: true,
      rng: scriptedRng([d20(11)]),
    });
    expect(roll.dice).toHaveLength(1);
  });

  it('succeeds on a natural 20 whatever the Evasion, and turns the damage critical', () => {
    const roll = rollAdversaryAttack({ modifier: 0, evasion: 99, rng: scriptedRng([d20(20)]) });
    expect(roll.critical).toBe(true);
    expect(roll.success).toBe(true);
  });

  it('adds an Experience when the GM spends a Fear for it', () => {
    const roll = rollAdversaryAttack({
      modifier: 1,
      experience: 2,
      evasion: 10,
      rng: scriptedRng([d20(7)]),
    });
    expect(roll.total).toBe(10);
    expect(roll.success).toBe(true);
  });
});

describe('adversary damage', () => {
  it('rolls the printed dice, with no Proficiency on the GM side', () => {
    const roll = rollAdversaryDamage({
      dice: { count: 1, die: 12 },
      modifier: 2,
      rng: scriptedRng([[7, 12]]),
    });
    expect(roll.total).toBe(9);
  });

  it('adds the dice maximum on a critical, leaving the flat modifier alone', () => {
    // 3d6+2 critical is 18 + the roll + 2 (SRD 2.0 p.86).
    const roll = rollAdversaryDamage({
      dice: { count: 3, die: 6 },
      modifier: 2,
      critical: true,
      rng: scriptedRng([[1, 6], [1, 6], [1, 6]]),
    });
    expect(roll.criticalBonus).toBe(18);
    expect(roll.total).toBe(18 + 3 + 2);
  });
});
