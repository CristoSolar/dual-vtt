import { spellcastTraitOf, type RollEntry } from '@daggerheart/protocol';
import { srd } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import {
  abilityTitle,
  cardAbilities,
  cardDamage,
  cardRoll,
  costShortfall,
  describeCost,
  knownEntryIds,
  landedRoll,
} from '../src/state/cardUse.js';
import { createSheet } from '../src/state/sheet.js';
import { buildCharacter } from './helpers.js';

const card = (id: string) => {
  const found = srd().domainCards.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no card ${id}`);
  return found;
};

describe('card use', () => {
  const wizard = createSheet(buildCharacter('wizard'));
  const trait = spellcastTraitOf(wizard);

  it('lists a grimoire’s spells by name, in the active language', () => {
    expect(cardAbilities('book-of-tyfar').map((a) => a.name)).toEqual([
      'Wild Flame',
      'Magic Hand',
      'Mysterious Mist',
    ]);
    const [wildFlame] = cardAbilities('book-of-tyfar');
    if (wildFlame === undefined) throw new Error('no spell');
    expect(abilityTitle(card('book-of-tyfar'), wildFlame)).toBe('BOOK OF TYFAR — Wild Flame');
  });

  it('rolls the Spellcast trait, with the Difficulty the card prints', () => {
    const mist = cardAbilities('book-of-tyfar')[2];
    if (mist === undefined || trait === null) throw new Error('setup');
    expect(cardRoll(card('book-of-tyfar'), mist, wizard)).toMatchObject({
      modifiers: wizard.character.traits[trait],
      difficulty: 13,
    });
    // Magic Hand has nothing to roll.
    const hand = cardAbilities('book-of-tyfar')[1];
    if (hand === undefined) throw new Error('setup');
    expect(cardRoll(card('book-of-tyfar'), hand, wizard)).toBeNull();
  });

  it('rolls printed dice as printed, and Proficiency dice at the sheet’s Proficiency', () => {
    const [wildFlame] = cardAbilities('book-of-tyfar');
    const [powerPush] = cardAbilities('book-of-ava');
    if (wildFlame === undefined || powerPush === undefined) throw new Error('setup');
    const proficient = { ...wizard, character: { ...wizard.character, proficiency: 2 } };
    expect(cardDamage(wildFlame, proficient)).toMatchObject({ scale: 'none', text: '2d6 magic' });
    expect(cardDamage(powerPush, proficient)).toMatchObject({
      dice: { count: 1, die: 10 },
      modifier: 2,
      scale: 'proficiency',
      text: '2d10+2 magic',
    });
  });

  it('says what a cost is, and what the sheet cannot pay', () => {
    expect(describeCost({ hope: 1, stress: 2, armor: 0 })).toEqual(['Spend 1 Hope', 'Mark 2 Stress']);
    expect(describeCost(undefined)).toEqual([]);
    const broke = { ...wizard, hope: 0 };
    expect(costShortfall(broke, { hope: 1, stress: 0, armor: 0 })).toBe(
      'Not enough Hope (need 1).',
    );
    // Stress is never short: it overflows into a Hit Point on the server.
    expect(costShortfall(broke, { hope: 0, stress: 9, armor: 0 })).toBeNull();
  });

  it('finds the roll that landed after it was sent, not an older one with the same label', () => {
    const roll = (id: string): RollEntry => ({
      kind: 'duality',
      id,
      at: 0,
      by: 'A',
      label: 'X — Y',
      roll: {
        hope: 5,
        fear: 3,
        total: 10,
        modifiers: 2,
        critical: false,
        withHope: true,
        advantageRoll: null,
        disadvantageRoll: null,
      },
      difficulty: 13,
      outcome: 'failureHope',
      experiences: [],
      reaction: false,
      target: null,
    });
    const before = [roll('old')];
    const known = knownEntryIds(before);
    expect(landedRoll('X — Y', known, before)).toBeNull();
    expect(landedRoll('X — Y', known, [roll('new'), ...before])?.id).toBe('new');
  });
});
