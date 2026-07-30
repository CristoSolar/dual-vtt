import { calcDamageThresholds, STARTING_HOPE, startingStats } from '@daggerheart/rules';

import { findArmor, findClass } from './lookup.js';
import { CharacterSchema, type Character, type CreationState } from './types.js';
import { validateAll } from './validate.js';

/** Every new character carries these regardless of class (SRD p.6). */
export const BASE_INVENTORY: readonly string[] = [
  'A torch',
  '50 feet of rope',
  'Basic supplies',
  'A handful of gold',
];

const POTIONS = {
  health: 'Minor Health Potion (clear 1d4 Hit Points)',
  stamina: 'Minor Stamina Potion (clear 1d4 Stress)',
} as const;

/** Raised by `finalize` when the creation is not yet complete. */
export class IncompleteCharacterError extends Error {
  constructor(readonly errors: ReturnType<typeof validateAll>['errors']) {
    super(
      `character creation is incomplete:\n${errors
        .map((e) => `  step ${e.step}: ${e.message}`)
        .join('\n')}`,
    );
    this.name = 'IncompleteCharacterError';
  }
}

/**
 * Turns a completed creation into a `Character`.
 *
 * Throws `IncompleteCharacterError` if any of the nine steps fails validation; that
 * is the only failure mode, since a state that validates always produces a character
 * satisfying `CharacterSchema`.
 */
export function finalize(state: CreationState): Character {
  const validation = validateAll(state);
  if (!validation.ok) throw new IncompleteCharacterError(validation.errors);

  // Every lookup below is known-present because validation passed.
  const characterClass = findClass(state.classId);
  const armorPiece = findArmor(state.equipment?.armorId ?? null);
  const { equipment, traits, heritage } = state;
  if (
    characterClass === null ||
    armorPiece === null ||
    equipment === null ||
    traits === null ||
    heritage === null ||
    state.communityId === null ||
    state.subclassId === null
  ) {
    // Unreachable: validation above guarantees each of these. Narrowing only.
    throw new Error('finalize: validated state is missing a required field');
  }

  const stats = startingStats(characterClass);
  // Damage thresholds are the armor's base plus the character's level (SRD p.56).
  const thresholds = calcDamageThresholds({ armor: armorPiece, level: stats.level });

  const experiences: Record<string, number> = {};
  for (const experience of state.experiences) experiences[experience.name] = experience.modifier;

  const inventory = [
    ...BASE_INVENTORY,
    POTIONS[equipment.potion],
    equipment.classItem,
    ...(equipment.spellCarrier === null ? [] : [equipment.spellCarrier]),
  ];

  return CharacterSchema.parse({
    name: state.name,
    pronouns: state.pronouns,

    classId: characterClass.id,
    subclassId: state.subclassId,
    heritage,
    communityId: state.communityId,

    level: stats.level,
    proficiency: stats.proficiency,
    evasion: stats.evasion,
    armorScore: armorPiece.baseScore,
    hpSlots: stats.hpSlots,
    stressSlots: stats.stressSlots,
    hope: STARTING_HOPE,

    traits,
    experiences,
    markedTraits: [],

    // Carried twice so both `levelUp` (flat) and `applyDamage` (object) accept this
    // character unchanged; `CharacterSchema` rejects any mismatch between them.
    major: thresholds.major,
    severe: thresholds.severe,
    thresholds,

    domainCards: [...state.domainCardIds],
    multiclass: null,
    advancementsTaken: [],

    equipment,
    inventory,
    background: state.background ?? '',
    connections: state.connections,
  });
}
