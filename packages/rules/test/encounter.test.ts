import { describe, expect, it } from 'vitest';

import {
  baseBattlePoints,
  battlePointBudget,
  battlePointsSpent,
  type AdversaryType,
} from '../src/encounter.js';

describe('Battle Points', () => {
  it('starts at three per PC plus two', () => {
    expect(baseBattlePoints(4)).toBe(14);
    expect(baseBattlePoints(0)).toBe(2);
  });

  it('applies the adjustments the GM chooses', () => {
    const line: AdversaryType[] = ['bruiser'];
    expect(battlePointBudget(4, line)).toBe(14);
    expect(battlePointBudget(4, line, { easier: true })).toBe(13);
    expect(battlePointBudget(4, line, { harder: true })).toBe(16);
    expect(battlePointBudget(4, line, { strongerDamage: true })).toBe(12);
    expect(battlePointBudget(4, line, { lowerTier: true })).toBe(15);
  });

  it('applies the two adjustments the line-up itself decides', () => {
    // Two Solos cost two points of budget.
    expect(battlePointBudget(4, ['solo', 'solo'])).toBe(12);
    // A fight with no Bruiser, Horde, Leader or Solo gains one.
    expect(battlePointBudget(4, ['standard', 'ranged'])).toBe(15);
  });

  it('charges each type what the SRD prints', () => {
    expect(battlePointsSpent(['social'], 4)).toBe(1);
    expect(battlePointsSpent(['standard', 'horde', 'skulk', 'ranged'], 4)).toBe(8);
    expect(battlePointsSpent(['leader'], 4)).toBe(3);
    expect(battlePointsSpent(['bruiser'], 4)).toBe(4);
    expect(battlePointsSpent(['solo'], 4)).toBe(5);
  });

  it('charges Minions by the group, not by the head', () => {
    const four: AdversaryType[] = ['minion', 'minion', 'minion', 'minion'];
    expect(battlePointsSpent(four, 4)).toBe(1);
    expect(battlePointsSpent([...four, 'minion'], 4)).toBe(2);
    expect(battlePointsSpent([], 4)).toBe(0);
  });
});
