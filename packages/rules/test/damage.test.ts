import { describe, expect, it } from 'vitest';

import {
  applyDamage,
  calcDamageThresholds,
  rollDamage,
  scriptedRng,
} from '../src/index.js';

describe('calcDamageThresholds', () => {
  it('adds the character level to the armor base thresholds', () => {
    const armor = { baseThresholds: { major: 6, severe: 13 } };
    expect(calcDamageThresholds({ armor, level: 1 })).toEqual({ major: 7, severe: 14 });
    expect(calcDamageThresholds({ armor, level: 5 })).toEqual({ major: 11, severe: 18 });
  });

  it('uses level and twice level while unarmored', () => {
    expect(calcDamageThresholds({ armor: null, level: 4 })).toEqual({ major: 4, severe: 8 });
  });

  it('adds feature bonuses on top', () => {
    const armor = { baseThresholds: { major: 6, severe: 13 } };
    expect(calcDamageThresholds({ armor, level: 1, bonuses: 3 })).toEqual({
      major: 10,
      severe: 17,
    });
  });
});

describe('rollDamage', () => {
  it('lets Proficiency multiply the dice count but never the modifier', () => {
    const result = rollDamage({
      dice: { count: 1, die: 8 },
      proficiency: 2,
      modifier: 2,
      rng: scriptedRng([[3, 8], [5, 8]]),
    });
    // Proficiency 2 with d8+2 rolls 2d8+2, not 2d8+4.
    expect(result.rolls).toEqual([3, 5]);
    expect(result.modifier).toBe(2);
    expect(result.total).toBe(10);
  });

  it('adds the maximum possible dice result on a critical', () => {
    const rolls = [[3, 8], [5, 8]] as const;
    const normal = rollDamage({
      dice: { count: 2, die: 8 },
      modifier: 1,
      rng: scriptedRng(rolls),
    });
    const critical = rollDamage({
      dice: { count: 2, die: 8 },
      modifier: 1,
      critical: true,
      rng: scriptedRng(rolls),
    });
    // Critical 2d8+1 deals roll + 16 + 1.
    expect(normal.total).toBe(3 + 5 + 1);
    expect(critical.criticalBonus).toBe(16);
    expect(critical.total).toBe(3 + 5 + 16 + 1);
    expect(critical.total).toBe(normal.total + 16);
  });

  it('defaults to Proficiency 1 and no modifier', () => {
    const result = rollDamage({ dice: { count: 1, die: 6 }, rng: scriptedRng([[4, 6]]) });
    expect(result.total).toBe(4);
  });
});

describe('applyDamage', () => {
  const thresholds = { major: 8, severe: 17 };

  it('marks 1 HP below Major, 2 at or above Major, 3 at or above Severe', () => {
    expect(applyDamage({ incoming: 7, thresholds }).hpMarked).toBe(1);
    expect(applyDamage({ incoming: 8, thresholds }).hpMarked).toBe(2);
    expect(applyDamage({ incoming: 16, thresholds }).hpMarked).toBe(2);
    expect(applyDamage({ incoming: 17, thresholds }).hpMarked).toBe(3);
    expect(applyDamage({ incoming: 40, thresholds }).hpMarked).toBe(3);
  });

  it('marks no HP when damage is reduced to 0 or less', () => {
    expect(applyDamage({ incoming: 0, thresholds }).hpMarked).toBe(0);
    expect(applyDamage({ incoming: -5, thresholds }).hpMarked).toBe(0);
  });

  it('halves damage from resistance before comparing thresholds', () => {
    const result = applyDamage({
      incoming: 20,
      thresholds,
      damageType: 'physical',
      resistances: ['physical'],
    });
    // 20 halved is 10: Major, not Severe.
    expect(result.damageAfterResistance).toBe(10);
    expect(result.resisted).toBe(true);
    expect(result.hpMarked).toBe(2);
  });

  it('rounds halved damage up, per the SRD round-up rule', () => {
    expect(
      applyDamage({ incoming: 9, thresholds, resistances: ['physical'] }).damageAfterResistance,
    ).toBe(5);
  });

  it('does not stack multiple resistances to the same type', () => {
    const once = applyDamage({ incoming: 20, thresholds, resistances: ['physical'] });
    const twice = applyDamage({
      incoming: 20,
      thresholds,
      resistances: ['physical', 'physical'],
    });
    expect(twice.damageAfterResistance).toBe(once.damageAfterResistance);
  });

  it('ignores damage entirely when immune', () => {
    const result = applyDamage({
      incoming: 40,
      thresholds,
      damageType: 'magic',
      immunities: ['magic'],
    });
    expect(result.immune).toBe(true);
    expect(result.hpMarked).toBe(0);
  });

  it('only resists combined physical and magic damage when resistant to both', () => {
    const onlyPhysical = applyDamage({
      incoming: 20,
      thresholds,
      damageType: 'both',
      resistances: ['physical'],
    });
    expect(onlyPhysical.resisted).toBe(false);

    const bothTypes = applyDamage({
      incoming: 20,
      thresholds,
      damageType: 'both',
      resistances: ['physical', 'magic'],
    });
    expect(bothTypes.resisted).toBe(true);
  });

  it('reduces severity by one threshold per Armor Slot marked', () => {
    expect(applyDamage({ incoming: 20, thresholds, armorSlotsMarked: 1 }).severity).toBe('major');
    expect(applyDamage({ incoming: 20, thresholds, armorSlotsMarked: 2 }).severity).toBe('minor');
    expect(applyDamage({ incoming: 20, thresholds, armorSlotsMarked: 3 }).hpMarked).toBe(0);
    expect(applyDamage({ incoming: 20, thresholds, armorSlotsMarked: 9 }).hpMarked).toBe(0);
  });

  it('ignores Armor Slots for direct damage', () => {
    const result = applyDamage({
      incoming: 20,
      thresholds,
      armorSlotsMarked: 2,
      direct: true,
    });
    expect(result.armorSlotsUsed).toBe(0);
    expect(result.hpMarked).toBe(3);
  });

  it('applies resistance before Armor Slots', () => {
    const result = applyDamage({
      incoming: 20,
      thresholds,
      resistances: ['physical'],
      armorSlotsMarked: 1,
    });
    // 20 -> 10 (Major) -> one slot -> Minor -> 1 HP.
    expect(result.hpMarked).toBe(1);
  });
});
