import { describe, expect, it } from 'vitest';

import {
  applyLevelUp,
  createSheet,
  markSheetArmorSlot,
  spendSheetGold,
  spendSheetHope,
  sendToVault,
} from '../src/sheet.js';

import { srd } from '@daggerheart/srd-data';

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

  it('caps multiclass domain cards at half the character level', () => {
    const base = sheet();
    const multiclassed = {
      ...base,
      character: {
        ...base.character,
        level: 5,
        multiclass: { classId: 'wizard' as const, domainId: 'codex' as const, subclassId: 'school-of-knowledge' },
      },
    };
    const codex = srd().domainCards.filter((c) => c.domain === 'codex');
    const tooHigh = codex.find((c) => c.level === 4);
    const allowed = codex.find((c) => c.level <= 3);
    if (tooHigh === undefined || allowed === undefined) throw new Error('no codex cards to test');

    const rejected = applyLevelUp(multiclassed, {
      advancements: ['domainCard', 'evasion'],
      extraDomainCardId: tooHigh.id,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.effect.code).toBe('cardTooHigh');
    expect(rejected.effect.params).toEqual({ card: tooHigh.name, cap: 3 });

    const accepted = applyLevelUp(multiclassed, {
      advancements: ['domainCard', 'evasion'],
      extraDomainCardId: allowed.id,
    });
    expect(accepted.ok).toBe(true);
  });

  it('a plain effect has code null', () => {
    const { effect } = spendSheetHope({ ...sheet(), hope: 3 }, 1);
    expect(effect.code).toBeNull();
    expect(effect.params).toBeUndefined();
  });
});
