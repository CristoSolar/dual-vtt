import { ancestries, classes } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import {
  assignTraits,
  levelUp,
  multiclassCardLevelCap,
  rollDice,
  rollDie,
  scriptedRng,
  seededRng,
  startingStats,
  tierForLevel,
  TRAIT_ARRAY,
  validateMixedAncestry,
  type Character,
} from '../src/index.js';

describe('rng helpers', () => {
  it('rollDie stays within 1..sides', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 500; i++) {
      const result = rollDie(12, rng);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(12);
    }
  });

  it('rollDice returns one result per die', () => {
    expect(rollDice(3, 6, seededRng(7))).toHaveLength(3);
  });

  it('seededRng is deterministic for a given seed', () => {
    expect(rollDice(5, 12, seededRng(99))).toEqual(rollDice(5, 12, seededRng(99)));
  });

  it('scriptedRng yields the scripted faces and then throws', () => {
    const rng = scriptedRng([4, 11]);
    expect(rollDie(12, rng)).toBe(4);
    expect(rollDie(12, rng)).toBe(11);
    expect(() => rollDie(12, rng)).toThrow('scriptedRng exhausted');
  });
});

describe('assignTraits', () => {
  it('accepts the +2/+1/+1/+0/+0/−1 array in any order', () => {
    const result = assignTraits({
      agility: 1,
      strength: 2,
      finesse: 0,
      instinct: -1,
      presence: 1,
      knowledge: 0,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an array that is not the SRD spread', () => {
    const result = assignTraits({
      agility: 2,
      strength: 2,
      finesse: 0,
      instinct: -1,
      presence: 1,
      knowledge: 0,
    });
    expect(result.ok).toBe(false);
  });

  it('uses exactly six modifiers', () => {
    expect(TRAIT_ARRAY).toEqual([2, 1, 1, 0, 0, -1]);
  });
});

describe('startingStats', () => {
  it('takes Evasion and HP from the class and fixes Hope at 2 and Stress at 6', () => {
    const bard = classes.find((c) => c.id === 'bard');
    expect(bard).toBeDefined();
    if (!bard) return;
    const stats = startingStats(bard);
    expect(stats.evasion).toBe(bard.startingEvasion);
    expect(stats.hpSlots).toBe(bard.startingHP);
    expect(stats.hope).toBe(2);
    expect(stats.stressSlots).toBe(6);
    expect(stats.level).toBe(1);
    expect(stats.proficiency).toBe(1);
  });
});

describe('validateMixedAncestry', () => {
  const goblin = ancestries.find((a) => a.id === 'goblin');
  const orc = ancestries.find((a) => a.id === 'orc');

  it('takes the first-slot feature from one ancestry and the second from another', () => {
    expect(goblin && orc).toBeTruthy();
    if (!goblin || !orc) return;
    const result = validateMixedAncestry(goblin, orc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The SRD's own goblin-orc example: "Surefooted" and "Tusks".
    expect(result.features[0]?.name).toBe('Surefooted');
    expect(result.features[1]?.name).toBe('Tusks');
  });

  it('rejects two features from the same ancestry', () => {
    if (!goblin) return;
    expect(validateMixedAncestry(goblin, goblin).ok).toBe(false);
  });

  it('cannot produce two first-slot features', () => {
    // "Surefooted" and "Sturdy" are both first-slot, so orc can only contribute "Tusks".
    if (!goblin || !orc) return;
    const result = validateMixedAncestry(goblin, orc);
    if (!result.ok) return;
    expect(result.features.map((f) => f.slot)).toEqual(['first', 'second']);
  });
});

describe('tierForLevel', () => {
  it('maps levels to the four tiers', () => {
    expect(tierForLevel(1)).toBe(1);
    expect([2, 3, 4].map(tierForLevel)).toEqual([2, 2, 2]);
    expect([5, 6, 7].map(tierForLevel)).toEqual([3, 3, 3]);
    expect([8, 9, 10].map(tierForLevel)).toEqual([4, 4, 4]);
  });
});

describe('multiclassCardLevelCap', () => {
  it('is half the level, rounded up', () => {
    expect(multiclassCardLevelCap(5)).toBe(3);
    expect(multiclassCardLevelCap(8)).toBe(4);
    expect(multiclassCardLevelCap(9)).toBe(5);
  });
});

describe('levelUp', () => {
  const base: Character = {
    level: 1,
    proficiency: 1,
    evasion: 10,
    hpSlots: 6,
    stressSlots: 6,
    experiences: { Blacksmith: 2, Survivor: 2 },
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    markedTraits: [],
    major: 7,
    severe: 14,
    domainCards: [],
    multiclass: null,
    advancementsTaken: [],
  };

  it('grants the level 2 tier achievement and raises thresholds by 1', () => {
    const result = levelUp(base, {
      advancements: ['hitPoint', 'stress'],
      newExperienceName: 'Tracker',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.level).toBe(2);
    expect(result.character.proficiency).toBe(2);
    expect(result.character.experiences.Tracker).toBe(2);
    expect(result.character.major).toBe(8);
    expect(result.character.severe).toBe(15);
    expect(result.character.hpSlots).toBe(7);
    expect(result.character.stressSlots).toBe(7);
    expect(result.achievement?.proficiencyIncrease).toBe(1);
  });

  it('grants no tier achievement on a non-achievement level', () => {
    const atThree = { ...base, level: 2 };
    const result = levelUp(atThree, { advancements: ['evasion', 'hitPoint'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.level).toBe(3);
    expect(result.achievement).toBeNull();
    expect(result.character.proficiency).toBe(1);
    expect(result.character.evasion).toBe(11);
  });

  it('lets Proficiency consume both advancement slots on its own', () => {
    const result = levelUp({ ...base, level: 2 }, { advancements: ['proficiency'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.proficiency).toBe(2);
  });

  it('rejects Proficiency paired with another advancement, which would spend three slots', () => {
    const result = levelUp({ ...base, level: 2 }, { advancements: ['proficiency', 'evasion'] });
    expect(result.ok).toBe(false);
  });

  it('rejects spending only one slot', () => {
    expect(levelUp({ ...base, level: 2 }, { advancements: ['evasion'] }).ok).toBe(false);
  });

  it('lets Multiclass consume both slots from level 5', () => {
    const atFive = { ...base, level: 4 };
    const result = levelUp(atFive, {
      advancements: ['multiclass'],
      multiclass: { classId: 'wizard', domainId: 'codex', subclassId: 'school-of-knowledge' },
      newExperienceName: 'Scholar',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.character.multiclass).toEqual({
      classId: 'wizard',
      domainId: 'codex',
      subclassId: 'school-of-knowledge',
    });
  });

  it('refuses multiclassing before level 5', () => {
    const result = levelUp(base, {
      advancements: ['multiclass'],
      multiclass: { classId: 'wizard', domainId: 'codex', subclassId: 'school-of-knowledge' },
    });
    expect(result).toEqual({ ok: false, error: 'multiclassing starts at level 5' });
  });

  it('clears marked traits at level 5 but not at level 2', () => {
    const marked = { ...base, level: 1, markedTraits: ['agility'] };
    const toTwo = levelUp(marked, { advancements: ['evasion', 'hitPoint'] });
    if (!toTwo.ok) return;
    expect(toTwo.character.markedTraits).toEqual(['agility']);

    const toFive = levelUp({ ...marked, level: 4 }, { advancements: ['evasion', 'hitPoint'] });
    if (!toFive.ok) return;
    expect(toFive.character.markedTraits).toEqual([]);
    expect(toFive.achievement?.clearedMarkedTraits).toBe(true);
  });

  it('marks the traits it increases and refuses to increase them again this tier', () => {
    const first = levelUp({ ...base, level: 2 }, {
      advancements: ['traits'],
      traitsToIncrease: ['agility', 'strength'],
    });
    expect(first.ok).toBe(false); // 'traits' costs one slot, so it needs a partner

    const paired = levelUp({ ...base, level: 2 }, {
      advancements: ['traits', 'evasion'],
      traitsToIncrease: ['agility', 'strength'],
    });
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    expect(paired.character.traits.agility).toBe(3);
    expect(paired.character.markedTraits).toEqual(['agility', 'strength']);

    const again = levelUp(paired.character, {
      advancements: ['traits', 'evasion'],
      traitsToIncrease: ['agility', 'finesse'],
    });
    expect(again.ok).toBe(false);
  });

  it('increases exactly two Experiences and rejects unknown ones', () => {
    const ok = levelUp({ ...base, level: 2 }, {
      advancements: ['experience', 'evasion'],
      experiencesToIncrease: ['Blacksmith', 'Survivor'],
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.character.experiences.Blacksmith).toBe(3);

    const unknown = levelUp({ ...base, level: 2 }, {
      advancements: ['experience', 'evasion'],
      experiencesToIncrease: ['Blacksmith', 'Nope'],
    });
    expect(unknown.ok).toBe(false);
  });

  it('records the domain card acquired in step four', () => {
    const result = levelUp({ ...base, level: 2 }, {
      advancements: ['evasion', 'hitPoint'],
      domainCardId: 'not-good-enough',
    });
    if (!result.ok) return;
    expect(result.character.domainCards).toEqual(['not-good-enough']);
  });

  it('refuses to level past 10', () => {
    expect(levelUp({ ...base, level: 10 }, { advancements: ['evasion', 'hitPoint'] }).ok).toBe(
      false,
    );
  });
});
