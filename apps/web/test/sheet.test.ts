import { scriptedRng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import {
  clearSheetStress,
  createSheet,
  isVulnerable,
  makeDamageRoll,
  makeDualityRoll,
  markSheetArmorSlot,
  markSheetHP,
  markSheetStress,
  recallFromVault,
  sendToVault,
  spendSheetHope,
  takeDamage,
} from '../src/state/sheet.js';
import { buildCharacter } from './helpers.js';

const sheetFor = (classId: Parameters<typeof buildCharacter>[0] = 'guardian') =>
  createSheet(buildCharacter(classId));

describe('createSheet', () => {
  it('starts undamaged with the character’s starting Hope and a handful of gold', () => {
    const sheet = sheetFor();
    expect(sheet.hpMarked).toBe(0);
    expect(sheet.stressMarked).toBe(0);
    expect(sheet.hope).toBe(sheet.character.hope);
    expect(sheet.gold).toEqual({ handfuls: 1, bags: 0, chests: 0 });
    expect(sheet.loadout).toHaveLength(2);
    expect(sheet.vault).toHaveLength(0);
  });
});

describe('stress and hit points', () => {
  it('sets Vulnerable when the last Stress is marked', () => {
    let sheet = sheetFor();
    const total = sheet.character.stressSlots;

    for (let i = 0; i < total - 1; i++) {
      const step = markSheetStress(sheet);
      sheet = step.sheet;
      expect(step.effect.vulnerable).toBe(false);
    }

    const last = markSheetStress(sheet);
    expect(last.effect.vulnerable).toBe(true);
    expect(isVulnerable(last.sheet)).toBe(true);
    expect(last.effect.message).toContain('Vulnerable');
  });

  it('marks 1 HP when Stress must be marked but none remains', () => {
    let sheet = sheetFor();
    sheet = markSheetStress(sheet, sheet.character.stressSlots).sheet;

    const overflow = markSheetStress(sheet);
    expect(overflow.effect.stressBecameHP).toBe(true);
    expect(overflow.sheet.hpMarked).toBe(1);
  });

  it('clears Vulnerable once Stress is cleared', () => {
    let sheet = sheetFor();
    sheet = markSheetStress(sheet, sheet.character.stressSlots).sheet;
    expect(isVulnerable(sheet)).toBe(true);
    sheet = clearSheetStress(sheet).sheet;
    expect(isVulnerable(sheet)).toBe(false);
  });

  it('requires a death move when the last Hit Point is marked', () => {
    let sheet = sheetFor();
    const total = sheet.character.hpSlots;

    for (let i = 0; i < total - 1; i++) {
      const step = markSheetHP(sheet);
      sheet = step.sheet;
      expect(step.effect.deathMoveRequired).toBe(false);
    }

    const last = markSheetHP(sheet);
    expect(last.effect.deathMoveRequired).toBe(true);
    expect(last.effect.message).toContain('death move');
  });
});

describe('takeDamage', () => {
  const sheet = sheetFor();
  const { major, severe } = sheet.character.thresholds;

  it('marks 1 HP below Major, 2 at Major, 3 at Severe', () => {
    const base = { damageType: 'physical' as const, direct: false, armorSlotsToMark: 0 };

    expect(takeDamage(sheet, { ...base, incoming: major - 1 }).applied.hpMarked).toBe(1);
    expect(takeDamage(sheet, { ...base, incoming: major }).applied.hpMarked).toBe(2);
    expect(takeDamage(sheet, { ...base, incoming: severe }).applied.hpMarked).toBe(3);
  });

  it('reduces severity by one threshold per Armor Slot marked', () => {
    const withArmor = takeDamage(sheet, {
      incoming: severe,
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 1,
    });
    // Severe reduced to Major, so 2 HP instead of 3, and a slot is spent.
    expect(withArmor.applied.hpMarked).toBe(2);
    expect(withArmor.sheet.armorSlotsMarked).toBe(1);
  });

  it('ignores Armor Slots for direct damage', () => {
    const direct = takeDamage(sheet, {
      incoming: severe,
      damageType: 'physical',
      direct: true,
      armorSlotsToMark: 2,
    });
    expect(direct.applied.hpMarked).toBe(3);
    expect(direct.sheet.armorSlotsMarked).toBe(0);
  });

  it('cannot spend more Armor Slots than the Armor Score allows', () => {
    const marked = markSheetArmorSlot(sheet, sheet.character.armorScore).sheet;
    const result = takeDamage(marked, {
      incoming: severe,
      damageType: 'physical',
      direct: false,
      armorSlotsToMark: 3,
    });
    expect(result.sheet.armorSlotsMarked).toBe(sheet.character.armorScore);
    expect(result.applied.hpMarked).toBe(3);
  });
});

describe('duality rolls', () => {
  it('reports matching dice as a critical success', () => {
    const sheet = sheetFor();
    const result = makeDualityRoll(
      sheet,
      { label: 'Agility Roll', modifiers: 0, difficulty: 30, advantage: 0, disadvantage: 0, experiences: [] },
      scriptedRng([7, 7]),
    );

    expect(result.outcome?.result.outcome).toBe('criticalSuccess');
    expect(result.outcome?.roll.critical).toBe(true);
    // A critical succeeds regardless of the Difficulty, and grants Hope and Stress relief.
    expect(result.outcome?.result.success).toBe(true);
    expect(result.sheet.hope).toBe(sheet.hope + 1);
  });

  it('spends 1 Hope per Experience used and adds its modifier', () => {
    const sheet = sheetFor();
    const result = makeDualityRoll(
      sheet,
      {
        label: 'Presence Roll',
        modifiers: 1,
        difficulty: 10,
        advantage: 0,
        disadvantage: 0,
        experiences: [{ name: 'Blacksmith', modifier: 2 }],
      },
      scriptedRng([5, 3]),
    );

    // 5 + 3 + 1 modifier + 2 Experience = 11.
    expect(result.outcome?.roll.total).toBe(11);
    // Spent 1 Hope, then gained 1 back for rolling with Hope.
    expect(result.sheet.hope).toBe(sheet.hope);
  });

  it('refuses the roll when there is not enough Hope for the Experiences', () => {
    let sheet = sheetFor();
    sheet = spendSheetHope(sheet, sheet.hope).sheet;

    const result = makeDualityRoll(
      sheet,
      {
        label: 'Presence Roll',
        modifiers: 0,
        difficulty: 10,
        advantage: 0,
        disadvantage: 0,
        experiences: [{ name: 'Blacksmith', modifier: 2 }],
      },
      scriptedRng([5, 3]),
    );

    expect(result.outcome).toBeNull();
    expect(result.effect.message).toContain('Not enough Hope');
  });

  it('grants the GM Fear on a roll with Fear', () => {
    const sheet = sheetFor();
    const result = makeDualityRoll(
      sheet,
      { label: 'Roll', modifiers: 0, difficulty: 5, advantage: 0, disadvantage: 0, experiences: [] },
      scriptedRng([2, 9]),
    );
    expect(result.outcome?.result.outcome).toBe('successFear');
    expect(result.outcome?.result.fearGained).toBe(1);
  });
});

describe('damage rolls', () => {
  it('multiplies dice by Proficiency but not the modifier', () => {
    const roll = makeDamageRoll(
      { dice: { count: 1, die: 8 }, proficiency: 2, modifier: 3, critical: false },
      scriptedRng([[4, 8], [6, 8]]),
    );
    expect(roll.rolls).toEqual([4, 6]);
    expect(roll.total).toBe(13);
  });

  it('adds the maximum dice result on a critical', () => {
    const roll = makeDamageRoll(
      { dice: { count: 2, die: 8 }, proficiency: 1, modifier: 1, critical: true },
      scriptedRng([[3, 8], [5, 8]]),
    );
    expect(roll.criticalBonus).toBe(16);
    expect(roll.total).toBe(3 + 5 + 16 + 1);
  });
});

describe('loadout', () => {
  it('marks Stress equal to the Recall Cost outside a rest', () => {
    let sheet = sheetFor();
    const cardId = sheet.loadout[0];
    if (cardId === undefined) throw new Error('no card');

    sheet = sendToVault(sheet, cardId).sheet;
    expect(sheet.vault).toContain(cardId);

    const recalled = recallFromVault(sheet, cardId, 2, { duringRest: false });
    expect(recalled.ok).toBe(true);
    expect(recalled.sheet.stressMarked).toBe(2);
    expect(recalled.sheet.loadout).toContain(cardId);
  });

  it('is free during a rest', () => {
    let sheet = sheetFor();
    const cardId = sheet.loadout[0];
    if (cardId === undefined) throw new Error('no card');

    sheet = sendToVault(sheet, cardId).sheet;
    const recalled = recallFromVault(sheet, cardId, 3, { duringRest: true });
    expect(recalled.ok).toBe(true);
    expect(recalled.sheet.stressMarked).toBe(0);
  });

  it('refuses to recall into a full loadout without vaulting a card', () => {
    let sheet = sheetFor();
    // Fill the loadout to its five-card maximum.
    sheet = { ...sheet, loadout: ['a', 'b', 'c', 'd', 'e'], vault: ['z'] };

    const blocked = recallFromVault(sheet, 'z', 1, { duringRest: true });
    expect(blocked.ok).toBe(false);
    expect(blocked.effect.message).toContain('full');

    const swapped = recallFromVault(sheet, 'z', 1, { duringRest: true, vaulting: 'c' });
    expect(swapped.ok).toBe(true);
    expect(swapped.sheet.loadout).toHaveLength(5);
    expect(swapped.sheet.vault).toContain('c');
  });
});
