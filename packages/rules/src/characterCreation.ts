import type { Ancestry, CharacterClass, Trait } from '@daggerheart/srd-data';

/** The trait modifiers every PC distributes at creation, in any order (SRD p.5). */
export const TRAIT_ARRAY: readonly number[] = [2, 1, 1, 0, 0, -1];
/** All PCs start with 2 Hope (SRD p.6). */
export const STARTING_HOPE = 2;
/** All classes start with 6 Stress slots (SRD p.6). */
export const STARTING_STRESS_SLOTS = 6;
/** Characters start a new campaign at Level 1 with Proficiency 1 (SRD p.6). */
export const STARTING_LEVEL = 1;
export const STARTING_PROFICIENCY = 1;
/** Each of a PC's two starting Experiences has a +2 modifier (SRD p.7). */
export const STARTING_EXPERIENCE_MODIFIER = 2;

export const TRAITS: readonly Trait[] = [
  'agility',
  'strength',
  'finesse',
  'instinct',
  'presence',
  'knowledge',
];

export type TraitAssignment = Record<Trait, number>;

/**
 * Validates an assignment of the +2/+1/+1/+0/+0/−1 array: every trait must appear
 * exactly once and the multiset of modifiers must match the array exactly.
 */
export function assignTraits(
  assignment: TraitAssignment,
): { ok: true; traits: TraitAssignment } | { ok: false; error: string } {
  const values = TRAITS.map((t) => assignment[t]);
  if (values.some((v) => !Number.isInteger(v))) {
    return { ok: false, error: 'every trait needs an integer modifier' };
  }

  const sortDesc = (a: number, b: number) => b - a;
  const got = [...values].sort(sortDesc);
  const want = [...TRAIT_ARRAY].sort(sortDesc);
  if (got.length !== want.length || got.some((v, i) => v !== want[i])) {
    return {
      ok: false,
      error: `trait modifiers must be exactly ${want.join(', ')} (got ${got.join(', ')})`,
    };
  }

  return { ok: true, traits: { ...assignment } };
}

/**
 * Mixed Ancestry takes the first-listed feature from one ancestry and the
 * second-listed feature from another, so the two must come from different ancestries
 * and occupy different slots (SRD p.31).
 */
export function validateMixedAncestry(
  first: Pick<Ancestry, 'id' | 'features'>,
  second: Pick<Ancestry, 'id' | 'features'>,
): { ok: true; features: [Ancestry['features'][number], Ancestry['features'][number]] } | {
  ok: false;
  error: string;
} {
  if (first.id === second.id) {
    return { ok: false, error: 'mixed ancestry must draw from two different ancestries' };
  }

  const firstFeature = first.features.find((f) => f.slot === 'first');
  const secondFeature = second.features.find((f) => f.slot === 'second');
  if (!firstFeature) return { ok: false, error: `${first.id} has no first-slot feature` };
  if (!secondFeature) return { ok: false, error: `${second.id} has no second-slot feature` };

  return { ok: true, features: [firstFeature, secondFeature] };
}

export interface StartingStats {
  level: number;
  proficiency: number;
  evasion: number;
  hpSlots: number;
  stressSlots: number;
  hope: number;
}

/** Starting Evasion and HP come from the class; Hope and Stress are fixed (SRD p.6). */
export function startingStats(
  characterClass: Pick<CharacterClass, 'startingEvasion' | 'startingHP'>,
): StartingStats {
  return {
    level: STARTING_LEVEL,
    proficiency: STARTING_PROFICIENCY,
    evasion: characterClass.startingEvasion,
    hpSlots: characterClass.startingHP,
    stressSlots: STARTING_STRESS_SLOTS,
    hope: STARTING_HOPE,
  };
}
