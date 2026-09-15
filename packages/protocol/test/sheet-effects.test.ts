import { describe, expect, it } from 'vitest';

import {
  applyLevelUp,
  createSheet,
  markSheetArmorSlot,
  spendSheetGold,
  spendSheetHope,
  sendToVault,
} from '../src/sheet.js';

import { makeCharacter } from './helpers.js';

const sheet = () => createSheet(makeCharacter());

describe('SheetEffect codes', () => {
  it('notEnoughHope carries the amount', () => {
    const s = { ...sheet(), hope: 0 };
    const { effect } = spendSheetHope(s, 2);
    expect(effect.code).toBe('notEnoughHope');
    expect(effect.params).toEqual({ amount: 2 });
    expect(effect.message).toContain('Not enough Hope');
  });

  it('noArmorSlots has no params', () => {
    const s = sheet();
    const { effect } = markSheetArmorSlot({ ...s, armorSlotsMarked: s.character.armorScore });
    expect(effect.code).toBe('noArmorSlots');
    expect(effect.params).toBeUndefined();
  });

  it('notEnoughGold carries amount and unit', () => {
    const { effect } = spendSheetGold(sheet(), 3, 'bags');
    expect(effect.code).toBe('notEnoughGold');
    expect(effect.params).toEqual({ amount: 3, unit: 'bags' });
  });

  it('vault errors surface as codes', () => {
    const { effect } = sendToVault(sheet(), 'not-a-card');
    expect(effect.code).toBe('cardNotInLoadout');
  });

  it('a rejected level-up keeps the rules message and a code', () => {
    const { effect } = applyLevelUp(sheet(), { advancements: [] });
    expect(effect.code).toBe('levelUpRejected');
    expect(effect.message).not.toBeNull();
  });

  it('a plain effect has code null', () => {
    const { effect } = spendSheetHope({ ...sheet(), hope: 3 }, 1);
    expect(effect.code).toBeNull();
    expect(effect.params).toBeUndefined();
  });
});
