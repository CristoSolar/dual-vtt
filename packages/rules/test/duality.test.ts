import { describe, expect, it } from 'vitest';

import {
  advantageDisadvantage,
  resolveActionRoll,
  resolveReactionRoll,
  rollDuality,
  scriptedRng,
} from '../src/index.js';

describe('advantageDisadvantage', () => {
  it('cancels one-for-one, leaving neither', () => {
    expect(advantageDisadvantage(1, 1)).toEqual({ advantage: 0, disadvantage: 0 });
    expect(advantageDisadvantage(3, 3)).toEqual({ advantage: 0, disadvantage: 0 });
  });

  it('leaves the surplus on whichever side had more', () => {
    expect(advantageDisadvantage(3, 1)).toEqual({ advantage: 2, disadvantage: 0 });
    expect(advantageDisadvantage(1, 3)).toEqual({ advantage: 0, disadvantage: 2 });
  });
});

describe('rollDuality', () => {
  it('sums both dice plus modifiers', () => {
    const roll = rollDuality({ modifiers: 1, rng: scriptedRng([5, 7]) });
    expect(roll.hope).toBe(5);
    expect(roll.fear).toBe(7);
    expect(roll.total).toBe(13);
    expect(roll.withHope).toBe(false);
    // The modifier folded into `total` must also be reported on its own — otherwise
    // a player sees hope + fear that don't add up to the total with no explanation.
    expect(roll.modifiers).toBe(1);
  });

  it('flags matching dice as critical and counts them as with Hope', () => {
    const roll = rollDuality({ rng: scriptedRng([9, 9]) });
    expect(roll.critical).toBe(true);
    expect(roll.withHope).toBe(true);
  });

  it('adds an advantage die and subtracts a disadvantage die', () => {
    const withAdvantage = rollDuality({ advantage: 1, rng: scriptedRng([4, 3, [5, 6]]) });
    expect(withAdvantage.advantageRoll).toBe(5);
    expect(withAdvantage.total).toBe(12);

    const withDisadvantage = rollDuality({ disadvantage: 1, rng: scriptedRng([4, 3, [5, 6]]) });
    expect(withDisadvantage.disadvantageRoll).toBe(5);
    expect(withDisadvantage.total).toBe(2);
  });

  it('rolls neither die when advantage and disadvantage cancel', () => {
    // Only two faces are scripted, so a third roll would throw.
    const roll = rollDuality({ advantage: 1, disadvantage: 1, rng: scriptedRng([4, 3]) });
    expect(roll.advantageRoll).toBeNull();
    expect(roll.disadvantageRoll).toBeNull();
    expect(roll.total).toBe(7);
  });

  it('honors a swapped Hope Die size', () => {
    const roll = rollDuality({ hopeDie: 20, rng: scriptedRng([[17, 20], [3, 12]]) });
    expect(roll.hope).toBe(17);
    expect(roll.fear).toBe(3);
  });
});

describe('resolveActionRoll', () => {
  it('returns criticalSuccess on matching dice, with Hope and a cleared Stress', () => {
    const roll = rollDuality({ rng: scriptedRng([6, 6]) });
    const result = resolveActionRoll(roll, 20);
    expect(result.outcome).toBe('criticalSuccess');
    expect(result.withHope).toBe(true);
    expect(result.success).toBe(true);
    expect(result.hopeGained).toBe(1);
    expect(result.stressCleared).toBe(1);
    expect(result.criticalDamage).toBe(true);
  });

  it('succeeds with Hope when the total meets the Difficulty and Hope is higher', () => {
    const result = resolveActionRoll(rollDuality({ rng: scriptedRng([9, 4]) }), 13);
    expect(result.outcome).toBe('successHope');
    expect(result.hopeGained).toBe(1);
    expect(result.fearGained).toBe(0);
  });

  it('succeeds with Fear when Fear is higher, giving the GM a Fear', () => {
    const result = resolveActionRoll(rollDuality({ rng: scriptedRng([4, 9]) }), 13);
    expect(result.outcome).toBe('successFear');
    expect(result.fearGained).toBe(1);
  });

  it('fails with Hope and with Fear below the Difficulty', () => {
    expect(resolveActionRoll(rollDuality({ rng: scriptedRng([5, 2]) }), 20).outcome).toBe(
      'failureHope',
    );
    expect(resolveActionRoll(rollDuality({ rng: scriptedRng([2, 5]) }), 20).outcome).toBe(
      'failureFear',
    );
  });
});

describe('resolveReactionRoll', () => {
  it('generates no Hope or Fear and negates on-success effects on a crit', () => {
    const result = resolveReactionRoll(rollDuality({ rng: scriptedRng([7, 7]) }), 30);
    expect(result.critical).toBe(true);
    expect(result.success).toBe(true);
    expect(result.ignoresEffects).toBe(true);
    // A reaction result carries no Hope/Fear/Stress fields at all.
    expect(Object.keys(result).sort()).toEqual(['critical', 'ignoresEffects', 'success']);
  });

  it('succeeds or fails on the total without a crit', () => {
    expect(resolveReactionRoll(rollDuality({ rng: scriptedRng([8, 5]) }), 13).success).toBe(true);
    expect(resolveReactionRoll(rollDuality({ rng: scriptedRng([2, 5]) }), 13).success).toBe(false);
    expect(resolveReactionRoll(rollDuality({ rng: scriptedRng([2, 5]) }), 13).ignoresEffects).toBe(
      false,
    );
  });
});
