import { classes } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import { appendRoll, MAX_LOG_ENTRIES, OUTCOME_LABELS, outcomeTone } from '../src/state/rollLog.js';
import { selectSheetView } from '../src/state/selectors.js';
import {
  applyLevelUp,
  createSheet,
  gainSheetGold,
  spendSheetGold,
} from '../src/state/sheet.js';
import { buildCharacter } from './helpers.js';

describe('wizard produces a usable sheet', () => {
  it('creates a populated sheet for every class', () => {
    for (const characterClass of classes) {
      const sheet = createSheet(buildCharacter(characterClass.id));
      const view = selectSheetView(sheet);

      expect(view.className, characterClass.id).toBe(characterClass.name);
      expect(view.subclassName).not.toBe('');
      expect(view.armor, `${characterClass.id} armor`).not.toBeNull();
      expect(view.primaryWeapon, `${characterClass.id} weapon`).not.toBeNull();
      expect(view.loadout).toHaveLength(2);
      expect(view.traits).toHaveLength(6);
      // Every class contributes at least a Hope feature and a community feature.
      expect(view.hopeFeature.name).not.toBe('');
      expect(view.communityFeature.name).not.toBe('');
      expect(sheet.character.inventory.length).toBeGreaterThan(0);
    }
  });

  it('gives a spellcasting subclass a Spellcast trait and a non-caster none', () => {
    expect(selectSheetView(createSheet(buildCharacter('wizard'))).spellcastTrait).not.toBeNull();
    expect(selectSheetView(createSheet(buildCharacter('guardian'))).spellcastTrait).toBeNull();
  });

  it('resolves damage thresholds from the equipped armor', () => {
    const sheet = createSheet(buildCharacter('bard'));
    const view = selectSheetView(sheet);
    expect(view.armor).not.toBeNull();
    if (view.armor === null) return;
    expect(sheet.character.major).toBe(view.armor.baseThresholds.major + 1);
    expect(sheet.character.severe).toBe(view.armor.baseThresholds.severe + 1);
  });
});

describe('gold', () => {
  it('carries handfuls into bags at ten', () => {
    let sheet = createSheet(buildCharacter());
    // Starts with 1 handful; nine more makes a bag.
    sheet = gainSheetGold(sheet, 9).sheet;
    expect(sheet.gold).toEqual({ handfuls: 0, bags: 1, chests: 0 });
  });

  it('refuses to spend more than is held', () => {
    const sheet = createSheet(buildCharacter());
    const result = spendSheetGold(sheet, 5);
    expect(result.sheet.gold).toEqual(sheet.gold);
    expect(result.effect.message).toContain('Not enough gold');
  });
});

describe('level up', () => {
  it('applies advancements through the rules engine', () => {
    const sheet = createSheet(buildCharacter('ranger'));
    const result = applyLevelUp(sheet, {
      advancements: ['hitPoint', 'stress'],
      newExperienceName: 'Tracker',
    });

    expect(result.ok).toBe(true);
    const next = result.sheet.character;
    expect(next.level).toBe(2);
    // Level 2 is a tier achievement: Proficiency rises and thresholds each go up by 1.
    expect(next.proficiency).toBe(2);
    expect(next.hpSlots).toBe(sheet.character.hpSlots + 1);
    expect(next.stressSlots).toBe(sheet.character.stressSlots + 1);
    expect(next.major).toBe(sheet.character.major + 1);
    expect(next.thresholds).toEqual({ major: next.major, severe: next.severe });
    expect(next.experiences.Tracker).toBe(2);
  });

  it('rejects a level-up that does not spend exactly two slots', () => {
    const sheet = createSheet(buildCharacter());
    const result = applyLevelUp(sheet, { advancements: ['evasion'] });
    expect(result.ok).toBe(false);
    expect(result.sheet).toBe(sheet);
  });

  it('refuses multiclassing before level 5', () => {
    const sheet = createSheet(buildCharacter());
    const result = applyLevelUp(sheet, {
      advancements: ['multiclass'],
      multiclass: { classId: 'wizard', domainId: 'codex', subclassId: 'school-of-knowledge' },
    });
    expect(result.ok).toBe(false);
    expect(result.effect.message).toContain('level 5');
  });
});

describe('roll log', () => {
  const entry = (id: string) =>
    ({
      kind: 'damage' as const,
      id,
      at: 0,
      by: 'Tester',
      label: 'Test',
      roll: { rolls: [1], criticalBonus: 0, modifier: 0, total: 1 },
      critical: false,
    });

  it('puts the newest roll first', () => {
    const log = appendRoll(appendRoll([], entry('a')), entry('b'));
    expect(log.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('caps the log so a long session cannot grow without bound', () => {
    let log = appendRoll([], entry('first'));
    for (let i = 0; i < MAX_LOG_ENTRIES + 10; i++) log = appendRoll(log, entry(`e${i}`));
    expect(log).toHaveLength(MAX_LOG_ENTRIES);
    expect(log.some((e) => e.id === 'first')).toBe(false);
  });

  it('labels and tones every outcome', () => {
    expect(OUTCOME_LABELS.criticalSuccess).toBe('Critical Success');
    expect(outcomeTone('criticalSuccess')).toBe('critical');
    expect(outcomeTone('successFear')).toBe('success');
    expect(outcomeTone('failureHope')).toBe('failure');
  });
});
