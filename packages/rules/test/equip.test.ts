import { srd } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import { canHold, equipArmor, weaponSwapCost } from '../src/index.js';

describe('wearing armor', () => {
  it('takes its Armor Score and base thresholds, plus the wearer level', () => {
    const armor = srd().armor.find((a) => a.tier === 1);
    if (armor === undefined) throw new Error('no tier 1 armor in the SRD data');

    const worn = equipArmor(armor, 3);
    expect(worn.armorScore).toBe(armor.baseScore);
    expect(worn.thresholds.major).toBe(armor.baseThresholds.major + 3);
    expect(worn.thresholds.severe).toBe(armor.baseThresholds.severe + 3);
  });

  it('leaves no Armor Slots when nothing is worn', () => {
    // Unarmored, Major is the level and Severe twice it (SRD p.72).
    const bare = equipArmor(null, 4);
    expect(bare.armorScore).toBe(0);
    expect(bare.thresholds).toEqual({ major: 4, severe: 8 });
  });

  it('folds a feature bonus into the thresholds', () => {
    const armor = srd().armor[0];
    if (armor === undefined) throw new Error('no armor in the SRD data');
    const worn = equipArmor(armor, 1, 2);
    expect(worn.thresholds.major).toBe(armor.baseThresholds.major + 1 + 2);
  });
});

describe('what a pair of hands can hold', () => {
  const one = { burden: 'oneHanded' } as const;
  const two = { burden: 'twoHanded' } as const;

  it('allows one-handed pairs and a lone two-handed weapon', () => {
    expect(canHold(one, one)).toBe(true);
    expect(canHold(two, null)).toBe(true);
    expect(canHold(null, one)).toBe(true);
  });

  it('refuses a secondary alongside a two-handed primary', () => {
    expect(canHold(two, one)).toBe(false);
  });

  it('refuses a two-handed weapon in the off hand', () => {
    expect(canHold(one, two)).toBe(false);
  });
});

describe('swapping a weapon', () => {
  it('costs a Stress outside a rest, and nothing during one', () => {
    expect(weaponSwapCost(false)).toBe(1);
    expect(weaponSwapCost(true)).toBe(0);
  });
});
