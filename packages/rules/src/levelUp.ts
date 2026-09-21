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
  /** How far the subclass has been taken: foundation, specialization, or mastery. */
  subclassTier: 'foundation' | 'specialization' | 'mastery';
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
  /**
   * Id of the extra card the 'domainCard' advancement grants, which is separate
   * from step four's.
   */
  extraDomainCardId?: string;
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

  // "Then cross out this tier's multiclass option" and, the other way round,
  // "cross out the upgraded subclass advancement option in this tier" (SRD 2.0
  // p.54), so the two cannot both be taken.
  if (
    choices.advancements.includes('multiclass') &&
    choices.advancements.includes('subclass')
  ) {
    return {
      ok: false,
      error: 'multiclassing and upgrading a subclass rule each other out',
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
  let { evasion, hpSlots, stressSlots, multiclass, subclassTier } = character;
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
      case 'domainCard': {
        // "You can choose an additional domain card at or below your level"
        // (SRD 2.0 p.54). It is a second card, not the one step four grants.
        const extra = choices.extraDomainCardId;
        if (extra === undefined) {
          return { ok: false, error: 'the additional domain card advancement needs a card' };
        }
        if (domainCards.includes(extra)) {
          return { ok: false, error: `already holding ${extra}` };
        }
        domainCards.push(extra);
        break;
      }
      case 'evasion':
        evasion += 1;
        break;
      case 'subclass': {
        // "If you have only the foundation card, take a specialization; if you have
        // a specialization already, take a mastery" (SRD 2.0 p.54).
        if (subclassTier === 'mastery') {
          return { ok: false, error: 'this subclass is already at mastery' };
        }
        subclassTier = subclassTier === 'foundation' ? 'specialization' : 'mastery';
        break;
      }
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
      subclassTier,
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
