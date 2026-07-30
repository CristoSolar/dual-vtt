import { describe, expect, it } from 'vitest';

import {
  clearArmorSlot,
  clearHP,
  clearStress,
  gainGold,
  goldToHandfuls,
  handfulsToGold,
  markArmorSlot,
  MAX_ARMOR_SCORE,
  spendGold,
  gainFear,
  gainHope,
  markHP,
  markStress,
  MAX_FEAR,
  MAX_HOPE,
  spendFear,
  spendHope,
} from '../src/index.js';

const pools = { hpMarked: 0, hpSlots: 6, stressMarked: 0, stressSlots: 6 };

describe('markStress', () => {
  it('marks the requested Stress', () => {
    const result = markStress(pools, 2);
    expect(result.stressMarked).toBe(2);
    expect(result.vulnerable).toBe(false);
  });

  it('becomes Vulnerable on marking the last Stress', () => {
    const result = markStress({ ...pools, stressMarked: 5 }, 1);
    expect(result.stressMarked).toBe(6);
    expect(result.vulnerable).toBe(true);
  });

  it('marks 1 HP instead when it must mark Stress but cannot', () => {
    const result = markStress({ ...pools, stressMarked: 6 }, 1);
    expect(result.stressMarkedNow).toBe(0);
    expect(result.hpMarkedInstead).toBe(1);
    expect(result.hpMarked).toBe(1);
  });

  it('substitutes only 1 HP no matter how much Stress went unmarked', () => {
    const result = markStress({ ...pools, stressMarked: 6 }, 3);
    expect(result.hpMarkedInstead).toBe(1);
  });

  it('requires a death move when the substituted HP was the last', () => {
    const result = markStress({ hpMarked: 5, hpSlots: 6, stressMarked: 6, stressSlots: 6 }, 1);
    expect(result.hpMarked).toBe(6);
    expect(result.deathMoveRequired).toBe(true);
  });
});

describe('markHP', () => {
  it('marks HP without exceeding the slots', () => {
    expect(markHP(pools, 2).hpMarked).toBe(2);
    expect(markHP({ ...pools, hpMarked: 5 }, 4).hpMarked).toBe(6);
  });

  it('requires a death move on marking the last Hit Point', () => {
    expect(markHP(pools, 2).deathMoveRequired).toBe(false);
    expect(markHP({ ...pools, hpMarked: 5 }, 1).deathMoveRequired).toBe(true);
  });
});

describe('clearStress / clearHP', () => {
  it('clears without going below zero', () => {
    expect(clearStress({ ...pools, stressMarked: 3 }, 2).stressMarked).toBe(1);
    expect(clearStress({ ...pools, stressMarked: 1 }, 5).stressMarked).toBe(0);
    expect(clearHP({ ...pools, hpMarked: 3 }, 2).hpMarked).toBe(1);
    expect(clearHP({ ...pools, hpMarked: 1 }, 5).hpMarked).toBe(0);
  });
});

describe('Hope and Fear caps', () => {
  it('caps Hope at 6', () => {
    expect(gainHope(2, 1)).toBe(3);
    expect(gainHope(5, 4)).toBe(MAX_HOPE);
    expect(MAX_HOPE).toBe(6);
  });

  it('caps Fear at 12', () => {
    expect(gainFear(11, 1)).toBe(12);
    expect(gainFear(11, 5)).toBe(MAX_FEAR);
    expect(MAX_FEAR).toBe(12);
  });

  it('refuses to spend more Hope or Fear than held', () => {
    expect(spendHope(3, 3)).toBe(0);
    expect(spendHope(2, 3)).toBeNull();
    expect(spendFear(5, 2)).toBe(3);
    expect(spendFear(1, 2)).toBeNull();
  });
});

describe('armor slots', () => {
  it('marks and clears within the Armor Score', () => {
    const slots = { marked: 0, score: 3 };
    expect(markArmorSlot(slots).marked).toBe(1);
    expect(markArmorSlot(slots, 2).marked).toBe(2);
    expect(markArmorSlot(slots, 9).marked).toBe(3);
    expect(clearArmorSlot({ marked: 2, score: 3 }).marked).toBe(1);
    expect(clearArmorSlot({ marked: 1, score: 3 }, 5).marked).toBe(0);
  });

  it('cannot mark any slot at an Armor Score of 0', () => {
    const result = markArmorSlot({ marked: 0, score: 0 });
    expect(result.markedNow).toBe(0);
    expect(result.marked).toBe(0);
  });

  it('never exceeds the maximum Armor Score of 12', () => {
    expect(markArmorSlot({ marked: 0, score: 99 }, 99).marked).toBe(MAX_ARMOR_SCORE);
  });
});

describe('gold', () => {
  const zero = { handfuls: 0, bags: 0, chests: 0 };

  it('carries 9 handfuls plus another into 1 bag', () => {
    expect(gainGold({ ...zero, handfuls: 9 }, 1)).toEqual({ handfuls: 0, bags: 1, chests: 0 });
  });

  it('carries 9 bags plus another into 1 chest', () => {
    expect(gainGold({ handfuls: 0, bags: 9, chests: 0 }, 1, 'bags')).toEqual({
      handfuls: 0,
      bags: 0,
      chests: 1,
    });
  });

  it('converts between denominations at 10 to 1', () => {
    expect(goldToHandfuls({ handfuls: 3, bags: 2, chests: 1 })).toBe(123);
    expect(handfulsToGold(123)).toEqual({ handfuls: 3, bags: 2, chests: 1 });
  });

  it('caps at a single chest', () => {
    const full = gainGold(zero, 500);
    expect(full.chests).toBe(1);
    expect(goldToHandfuls(full)).toBe(199);
  });

  it('spends by breaking larger denominations', () => {
    expect(spendGold({ handfuls: 0, bags: 1, chests: 0 }, 1)).toEqual({
      handfuls: 9,
      bags: 0,
      chests: 0,
    });
  });

  it('refuses to spend more than is held', () => {
    expect(spendGold({ ...zero, handfuls: 2 }, 3)).toBeNull();
    expect(spendGold(zero, 1, 'chests')).toBeNull();
  });
});
