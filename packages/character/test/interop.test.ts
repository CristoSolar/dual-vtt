import {
  applyDamage,
  calcDamageThresholds,
  levelUp,
  markHP,
  markStress,
  rollDamage,
  scriptedRng,
  type Character as RulesCharacter,
} from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import { AdvancementSchema, CharacterSchema, finalize, type Character } from '../src/index.js';
import { buildCharacter } from './helpers.js';

describe('advancement parity', () => {
  it('mirrors the rules package Advancement union exactly', () => {
    // Assignable in both directions, so neither list can gain or lose a member
    // without this failing to compile.
    type Ours = (typeof AdvancementSchema.options)[number];
    type Theirs = Parameters<typeof levelUp>[1]['advancements'][number];
    const ours: Theirs[] = [...AdvancementSchema.options];
    const theirs: Ours[] = ours;
    expect(theirs).toHaveLength(9);
  });
});

describe('a finalized Character is consumable by the rules package', () => {
  const character: Character = finalize(buildCharacter('guardian'));

  it('satisfies the rules package Character type structurally', () => {
    // Compiles only if every field `levelUp` needs is present with the right type.
    const asRulesCharacter: RulesCharacter = character;
    expect(asRulesCharacter.level).toBe(1);
    expect(asRulesCharacter.markedTraits).toEqual([]);
    expect(asRulesCharacter.multiclass).toBeNull();
    expect(asRulesCharacter.advancementsTaken).toEqual([]);
  });

  it('is accepted by applyDamage without adaptation', () => {
    const minor = applyDamage({ incoming: 1, thresholds: character.thresholds });
    expect(minor.hpMarked).toBe(1);

    const major = applyDamage({ incoming: character.major, thresholds: character.thresholds });
    expect(major.hpMarked).toBe(2);

    const severe = applyDamage({ incoming: character.severe, thresholds: character.thresholds });
    expect(severe.hpMarked).toBe(3);
  });

  it('is accepted by levelUp without adaptation', () => {
    const result = levelUp(character, {
      advancements: ['hitPoint', 'stress'],
      newExperienceName: 'Tracker',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.level).toBe(2);
    // Level 2 is a tier achievement: +1 Proficiency and a new Experience at +2.
    expect(result.character.proficiency).toBe(2);
    expect(result.character.experiences.Tracker).toBe(2);
    // Every damage threshold increases by 1 on level-up.
    expect(result.character.major).toBe(character.major + 1);
    expect(result.character.severe).toBe(character.severe + 1);
    expect(result.character.hpSlots).toBe(character.hpSlots + 1);
    expect(result.character.stressSlots).toBe(character.stressSlots + 1);
  });

  it('feeds its own stats back into calcDamageThresholds consistently', () => {
    const recomputed = calcDamageThresholds({
      armor: { baseThresholds: { major: character.major - 1, severe: character.severe - 1 } },
      level: character.level,
    });
    expect(recomputed).toEqual(character.thresholds);
  });

  it('supplies pools that markStress and markHP accept', () => {
    const pools = {
      hpMarked: 0,
      hpSlots: character.hpSlots,
      stressMarked: 0,
      stressSlots: character.stressSlots,
    };

    expect(markStress(pools, 1).stressMarked).toBe(1);
    expect(markHP(pools, 1).hpMarked).toBe(1);
    // A fresh character is nowhere near a death move.
    expect(markHP(pools, 1).deathMoveRequired).toBe(false);
  });

  it('rolls its equipped weapon damage at its Proficiency', () => {
    const roll = rollDamage({
      dice: { count: 1, die: 8 },
      proficiency: character.proficiency,
      modifier: 1,
      rng: scriptedRng([[5, 8]]),
    });
    // Proficiency 1 at level 1 means one damage die.
    expect(roll.rolls).toHaveLength(1);
    expect(roll.total).toBe(6);
  });
});

describe('multiclassing', () => {
  /** A character advanced to level 5, the earliest a multiclass can be taken. */
  const atLevelFive = (): Character => {
    let current = finalize(buildCharacter('bard'));
    for (const level of [2, 3, 4] as const) {
      const result = levelUp(current, {
        advancements: ['evasion', 'hitPoint'],
        newExperienceName: `Level ${level}`,
      });
      if (!result.ok) throw new Error(result.error);
      // Parsed rather than cast: the rules package types multiclass ids as plain
      // strings, while a Character requires real class and domain ids.
      current = CharacterSchema.parse({
        ...current,
        ...result.character,
        thresholds: { major: result.character.major, severe: result.character.severe },
      });
    }
    return current;
  };

  it('levels into a multiclass and round-trips through CharacterSchema unchanged', () => {
    const before = atLevelFive();
    const result = levelUp(before, {
      advancements: ['multiclass'],
      multiclass: { classId: 'wizard', domainId: 'codex', subclassId: 'school-of-knowledge' },
      newExperienceName: 'Arcane Study',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.level).toBe(5);
    expect(result.character.multiclass).toEqual({
      classId: 'wizard',
      domainId: 'codex',
      subclassId: 'school-of-knowledge',
    });

    // The multiclassed character must satisfy the schema and survive a round trip.
    const multiclassed = CharacterSchema.parse({
      ...before,
      ...result.character,
      thresholds: { major: result.character.major, severe: result.character.severe },
    });

    const parsed = CharacterSchema.parse(multiclassed);
    expect(parsed.multiclass).toEqual(multiclassed.multiclass);
    expect(CharacterSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });

  it('rejects an unknown multiclass class or domain at the schema boundary', () => {
    const character = finalize(buildCharacter('bard'));
    expect(
      CharacterSchema.safeParse({
        ...character,
        multiclass: { classId: 'notaclass', domainId: 'codex', subclassId: 'x' },
      }).success,
    ).toBe(false);
    expect(
      CharacterSchema.safeParse({
        ...character,
        multiclass: { classId: 'wizard', domainId: 'notadomain', subclassId: 'x' },
      }).success,
    ).toBe(false);
  });

  it('refuses a second multiclass', () => {
    const before = atLevelFive();
    const first = levelUp(before, {
      advancements: ['multiclass'],
      multiclass: { classId: 'wizard', domainId: 'codex', subclassId: 'school-of-knowledge' },
    });
    if (!first.ok) throw new Error(first.error);

    const second = levelUp(first.character, {
      advancements: ['multiclass'],
      multiclass: { classId: 'rogue', domainId: 'midnight', subclassId: 'nightwalker' },
    });
    expect(second.ok).toBe(false);
  });
});
