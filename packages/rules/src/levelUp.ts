import type { Tier } from '@daggerheart/srd-data';

/** Advancement options available on level-up (SRD p.43). */
export type Advancement =
  | 'traits'
  | 'hitPoint'
  | 'stress'
  | 'experience'
  | 'domainCard'
  | 'evasion'
  | 'subclass'
  | 'proficiency'
  | 'multiclass';

/**
 * Proficiency and Multiclass each occupy a black box spanning two slots, so taking
 * either spends both of the level's advancements (SRD p.43).
 */
export const ADVANCEMENT_SLOT_COST: Record<Advancement, number> = {
  traits: 1,
  hitPoint: 1,
  stress: 1,
  experience: 1,
  domainCard: 1,
  evasion: 1,
  subclass: 1,
  proficiency: 2,
  multiclass: 2,
};

/** Each level-up spends two advancement slots (SRD p.43). */
export const SLOTS_PER_LEVEL = 2;
/** Multiclassing only becomes available at level 5 (SRD p.43). */
export const MULTICLASS_MIN_LEVEL = 5;

/**
 * What multiclassing grants: an additional class, access to one of its domains, and
 * a foundation card from one of its subclasses (SRD p.43).
 */
export interface Multiclass {
  classId: string;
  /** The one domain of the additional class this character gains access to. */
  domainId: string;
  /** The subclass whose foundation card was taken. */
  subclassId: string;
}

/** Tier 1 is level 1, tier 2 levels 2-4, tier 3 levels 5-7, tier 4 levels 8-10 (SRD p.42). */
export function tierForLevel(level: number): Tier {
  if (level <= 1) return 1;
  if (level <= 4) return 2;
  if (level <= 7) return 3;
  return 4;
}

/** Levels that grant a tier achievement (SRD p.42). */
export const TIER_ACHIEVEMENT_LEVELS: readonly number[] = [2, 5, 8];

export interface Character {
  level: number;
  proficiency: number;
  evasion: number;
  hpSlots: number;
  stressSlots: number;
  /** Experience name -> modifier. */
  experiences: Readonly<Record<string, number>>;
  /** Trait name -> modifier. */
  traits: Readonly<Record<string, number>>;
  /**
   * Traits marked by the "increase two traits" advancement. They can't be increased
   * again until a tier achievement clears the marks (SRD p.43).
   */
  markedTraits: readonly string[];
  major: number;
  severe: number;
  /** Ids of domain cards acquired. */
  domainCards: readonly string[];
  /** The additional class taken through multiclassing, or null. */
  multiclass: Multiclass | null;
  /** Advancements taken so far, for options that can only be taken once per tier. */
  advancementsTaken: readonly Advancement[];
}

export interface LevelUpChoices {
  /** The two advancement slots being spent. One entry when it costs both slots. */
  advancements: readonly Advancement[];
  /** Traits to increase, required when taking the 'traits' advancement (exactly two). */
  traitsToIncrease?: readonly string[];
  /** Experiences to increase, required when taking the 'experience' advancement (exactly two). */
  experiencesToIncrease?: readonly string[];
  /** Name of the new Experience granted by a tier achievement. */
  newExperienceName?: string;
  /** The additional class, domain, and subclass, required by the 'multiclass' advancement. */
  multiclass?: Multiclass;
  /** Id of the domain card acquired in step four. */
  domainCardId?: string;
}

export interface TierAchievement {
  newExperienceModifier: number;
  proficiencyIncrease: number;
  clearedMarkedTraits: boolean;
}

/**
 * Applies one level-up: tier achievements, then two advancement slots, then +1 to all
 * damage thresholds, then the new domain card (SRD p.42-43).
 *
 * Returns an error rather than throwing so callers can surface invalid choices.
 */
export function levelUp(
  character: Character,
  choices: LevelUpChoices,
): { ok: true; character: Character; achievement: TierAchievement | null } | {
  ok: false;
  error: string;
} {
  const level = character.level + 1;
  if (level > 10) return { ok: false, error: 'level 10 is the maximum' };

  const slotsSpent = choices.advancements.reduce(
    (sum, a) => sum + ADVANCEMENT_SLOT_COST[a],
    0,
  );
  if (slotsSpent !== SLOTS_PER_LEVEL) {
    return {
      ok: false,
      error: `level-up spends exactly ${SLOTS_PER_LEVEL} advancement slots (got ${slotsSpent})`,
    };
  }

  if (choices.advancements.includes('multiclass')) {
    if (level < MULTICLASS_MIN_LEVEL) {
      return { ok: false, error: `multiclassing starts at level ${MULTICLASS_MIN_LEVEL}` };
    }
    if (choices.multiclass === undefined) {
      return {
        ok: false,
        error: 'multiclass advancement needs a class, a domain, and a subclass',
      };
    }
    if (character.multiclass !== null) {
      return { ok: false, error: 'already multiclassed' };
    }
  }

  // STEP ONE: tier achievements.
  let proficiency = character.proficiency;
  let experiences = { ...character.experiences };
  let markedTraits = [...character.markedTraits];
  let achievement: TierAchievement | null = null;

  if (TIER_ACHIEVEMENT_LEVELS.includes(level)) {
    proficiency += 1;
    const clearsTraits = level === 5 || level === 8;
    if (clearsTraits) markedTraits = [];
    if (choices.newExperienceName !== undefined) {
      experiences[choices.newExperienceName] = 2;
    }
    achievement = {
      newExperienceModifier: 2,
      proficiencyIncrease: 1,
      clearedMarkedTraits: clearsTraits,
    };
  }

  // STEP TWO: advancements.
  let { evasion, hpSlots, stressSlots, multiclass } = character;
  let traits = { ...character.traits };
  const domainCards = [...character.domainCards];

  for (const advancement of choices.advancements) {
    switch (advancement) {
      case 'traits': {
        const picks = choices.traitsToIncrease ?? [];
        if (picks.length !== 2) {
          return { ok: false, error: 'the traits advancement increases exactly two traits' };
        }
        for (const trait of picks) {
          if (markedTraits.includes(trait)) {
            return { ok: false, error: `${trait} is marked and can't be increased this tier` };
          }
        }
        for (const trait of picks) {
          traits[trait] = (traits[trait] ?? 0) + 1;
          markedTraits.push(trait);
        }
        break;
      }
      case 'hitPoint':
        hpSlots += 1;
        break;
      case 'stress':
        stressSlots += 1;
        break;
      case 'experience': {
        const picks = choices.experiencesToIncrease ?? [];
        if (picks.length !== 2) {
          return {
            ok: false,
            error: 'the experience advancement increases exactly two Experiences',
          };
        }
        for (const name of picks) {
          if (!(name in experiences)) {
            return { ok: false, error: `unknown Experience: ${name}` };
          }
        }
        for (const name of picks) {
          experiences[name] = (experiences[name] ?? 0) + 1;
        }
        break;
      }
      case 'domainCard':
        // The extra card is chosen alongside step four's card by the caller.
        break;
      case 'evasion':
        evasion += 1;
        break;
      case 'subclass':
        break;
      case 'proficiency':
        proficiency += 1;
        break;
      case 'multiclass':
        multiclass = choices.multiclass ?? null;
        break;
    }
  }

  // STEP THREE: increase all damage thresholds by 1.
  const major = character.major + 1;
  const severe = character.severe + 1;

  // STEP FOUR: acquire a domain card.
  if (choices.domainCardId !== undefined) domainCards.push(choices.domainCardId);

  return {
    ok: true,
    achievement,
    character: {
      ...character,
      level,
      proficiency,
      evasion,
      hpSlots,
      stressSlots,
      experiences,
      traits,
      markedTraits,
      major,
      severe,
      domainCards,
      multiclass,
      advancementsTaken: [...character.advancementsTaken, ...choices.advancements],
    },
  };
}

/**
 * Whenever a multiclassed PC gains a domain card, they may take it from their
 * multiclass domain at or below half their level, rounded up (SRD p.43).
 */
export function multiclassCardLevelCap(level: number): number {
  return Math.ceil(level / 2);
}
