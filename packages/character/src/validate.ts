import { assignTraits, validateMixedAncestry } from '@daggerheart/rules';

import {
  canUseMagicWeapons,
  findAncestry,
  findArmor,
  findClass,
  findCommunity,
  findDomainCard,
  findSubclass,
  findWeapon,
  classItemOptions,
  requiresSpellcast,
  STARTING_TIER,
} from './lookup.js';
import type { CreationState, Step, ValidationError, ValidationResult } from './types.js';

const err = (
  step: Step,
  code: string,
  message: string,
  field: string | null = null,
): ValidationError => ({ step, code, message, field });

const result = (errors: readonly ValidationError[]): ValidationResult =>
  errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };

/** The number of Experiences and their modifier are both fixed at creation (SRD p.7). */
const REQUIRED_EXPERIENCES = 2;
const EXPERIENCE_MODIFIER = 2;
const REQUIRED_DOMAIN_CARDS = 2;

/** Validates one step against the current state. Never throws. */
export function validateStep(state: CreationState, step: Step): ValidationResult {
  const errors: ValidationError[] = [];
  const characterClass = findClass(state.classId);

  switch (step) {
    case 1: {
      if (characterClass === null) {
        errors.push(err(1, 'classRequired', 'choose a class', 'classId'));
        break;
      }
      const subclass = findSubclass(state.subclassId);
      if (subclass === null) {
        errors.push(err(1, 'subclassRequired', 'choose a subclass', 'subclassId'));
      } else if (subclass.classId !== characterClass.id) {
        errors.push(
          err(
            1,
            'subclassMismatch',
            `${subclass.name} is not a ${characterClass.name} subclass`,
            'subclassId',
          ),
        );
      }
      break;
    }

    case 2: {
      const { heritage } = state;
      if (heritage === null) {
        errors.push(err(2, 'ancestryRequired', 'choose an ancestry', 'heritage'));
      } else if (heritage.kind === 'single') {
        if (findAncestry(heritage.ancestryId) === null) {
          errors.push(
            err(2, 'unknownAncestry', `unknown ancestry: ${heritage.ancestryId}`, 'heritage'),
          );
        }
      } else {
        const first = findAncestry(heritage.first.ancestryId);
        const second = findAncestry(heritage.second.ancestryId);
        if (first === null) {
          errors.push(
            err(2, 'unknownAncestry', `unknown ancestry: ${heritage.first.ancestryId}`, 'heritage'),
          );
        }
        if (second === null) {
          errors.push(
            err(
              2,
              'unknownAncestry',
              `unknown ancestry: ${heritage.second.ancestryId}`,
              'heritage',
            ),
          );
        }

        // A Mixed Ancestry takes the first-listed feature from one ancestry and the
        // second-listed from another, so the two picks must occupy different slots
        // (SRD p.31): "You can't take both the Surefooted and Sturdy features,
        // because these are both the first features listed on their ancestry cards."
        if (heritage.first.slot === heritage.second.slot) {
          errors.push(
            err(
              2,
              'duplicateAncestrySlot',
              `a mixed ancestry takes one first-listed and one second-listed feature, not two ${heritage.first.slot}-listed ones`,
              'heritage',
            ),
          );
        }

        if (first !== null && second !== null) {
          // Ask the rules package the same question in the order it expects.
          const [firstSlotAncestry, secondSlotAncestry] =
            heritage.first.slot === 'first' ? [first, second] : [second, first];
          const mixed = validateMixedAncestry(firstSlotAncestry, secondSlotAncestry);
          if (!mixed.ok) {
            errors.push(err(2, 'invalidMixedAncestry', mixed.error, 'heritage'));
          }
        }
      }

      if (state.communityId === null) {
        errors.push(err(2, 'communityRequired', 'choose a community', 'communityId'));
      } else if (findCommunity(state.communityId) === null) {
        errors.push(
          err(2, 'unknownCommunity', `unknown community: ${state.communityId}`, 'communityId'),
        );
      }
      break;
    }

    case 3: {
      if (state.traits === null) {
        errors.push(err(3, 'traitsRequired', 'assign the trait array', 'traits'));
        break;
      }
      const assigned = assignTraits(state.traits);
      if (!assigned.ok) errors.push(err(3, 'invalidTraitArray', assigned.error, 'traits'));
      break;
    }

    case 4:
      // Step 4 records values derived from the class rather than choosing any.
      if (characterClass === null) {
        errors.push(err(4, 'classRequired', 'derived stats need a class', 'classId'));
      }
      break;

    case 5: {
      const { equipment } = state;
      if (equipment === null) {
        errors.push(err(5, 'equipmentRequired', 'choose starting equipment', 'equipment'));
        break;
      }

      const primary = findWeapon(equipment.primaryWeaponId);
      if (primary === null) {
        errors.push(
          err(
            5,
            'unknownWeapon',
            `unknown weapon: ${equipment.primaryWeaponId}`,
            'equipment.primaryWeaponId',
          ),
        );
      } else {
        if (primary.category !== 'primary') {
          errors.push(
            err(
              5,
              'notPrimaryWeapon',
              `${primary.name} is a secondary weapon`,
              'equipment.primaryWeaponId',
            ),
          );
        }
        if (primary.tier !== STARTING_TIER) {
          errors.push(
            err(
              5,
              'weaponTierTooHigh',
              `${primary.name} is Tier ${primary.tier}; characters start at Tier ${STARTING_TIER}`,
              'equipment.primaryWeaponId',
            ),
          );
        }
        if (requiresSpellcast(primary) && !canUseMagicWeapons(state)) {
          errors.push(
            err(
              5,
              'spellcastRequired',
              `${primary.name} requires a Spellcast trait`,
              'equipment.primaryWeaponId',
            ),
          );
        }
      }

      const secondary = findWeapon(equipment.secondaryWeaponId);
      if (equipment.secondaryWeaponId !== null && secondary === null) {
        errors.push(
          err(
            5,
            'unknownWeapon',
            `unknown weapon: ${equipment.secondaryWeaponId}`,
            'equipment.secondaryWeaponId',
          ),
        );
      }
      if (secondary !== null) {
        if (secondary.category !== 'secondary') {
          errors.push(
            err(
              5,
              'notSecondaryWeapon',
              `${secondary.name} is a primary weapon`,
              'equipment.secondaryWeaponId',
            ),
          );
        }
        if (secondary.tier !== STARTING_TIER) {
          errors.push(
            err(
              5,
              'weaponTierTooHigh',
              `${secondary.name} is Tier ${secondary.tier}; characters start at Tier ${STARTING_TIER}`,
              'equipment.secondaryWeaponId',
            ),
          );
        }
        if (requiresSpellcast(secondary) && !canUseMagicWeapons(state)) {
          errors.push(
            err(
              5,
              'spellcastRequired',
              `${secondary.name} requires a Spellcast trait`,
              'equipment.secondaryWeaponId',
            ),
          );
        }
      }

      // Maximum burden is 2 hands: either a two-handed primary on its own, or a
      // one-handed primary alongside a one-handed secondary (SRD p.44).
      if (primary !== null && secondary !== null && primary.burden === 'twoHanded') {
        errors.push(
          err(
            5,
            'burdenExceeded',
            `${primary.name} is two-handed, leaving no hand for ${secondary.name}`,
            'equipment.secondaryWeaponId',
          ),
        );
      }
      if (primary !== null && secondary !== null && secondary.burden === 'twoHanded') {
        errors.push(
          err(
            5,
            'burdenExceeded',
            `${secondary.name} is two-handed and can't be held alongside a primary weapon`,
            'equipment.secondaryWeaponId',
          ),
        );
      }

      const armorPiece = findArmor(equipment.armorId);
      if (armorPiece === null) {
        errors.push(
          err(5, 'unknownArmor', `unknown armor: ${equipment.armorId}`, 'equipment.armorId'),
        );
      } else if (armorPiece.tier !== STARTING_TIER) {
        errors.push(
          err(
            5,
            'armorTierTooHigh',
            `${armorPiece.name} is Tier ${armorPiece.tier}; characters start at Tier ${STARTING_TIER}`,
            'equipment.armorId',
          ),
        );
      }

      if (characterClass !== null) {
        const allowed = classItemOptions(characterClass);
        if (!allowed.includes(equipment.classItem)) {
          errors.push(
            err(
              5,
              'invalidClassItem',
              `class item must be one of: ${allowed.join(' / ')}`,
              'equipment.classItem',
            ),
          );
        }
      }

      if (canUseMagicWeapons(state)) {
        if (equipment.spellCarrier === null || equipment.spellCarrier.trim() === '') {
          errors.push(
            err(
              5,
              'spellCarrierRequired',
              'a spellcasting character carries an item for their spells',
              'equipment.spellCarrier',
            ),
          );
        }
      } else if (equipment.spellCarrier !== null) {
        errors.push(
          err(
            5,
            'spellCarrierNotApplicable',
            'this character has no Spellcast trait and carries no spells',
            'equipment.spellCarrier',
          ),
        );
      }
      break;
    }

    case 6:
      if (state.background === null) {
        errors.push(err(6, 'backgroundRequired', 'write a background', 'background'));
      }
      break;

    case 7: {
      const { experiences } = state;
      if (experiences.length !== REQUIRED_EXPERIENCES) {
        errors.push(
          err(
            7,
            'experienceCount',
            `choose exactly ${REQUIRED_EXPERIENCES} Experiences (got ${experiences.length})`,
            'experiences',
          ),
        );
      }
      for (const experience of experiences) {
        if (experience.name.trim() === '') {
          errors.push(err(7, 'emptyExperience', 'an Experience needs a name', 'experiences'));
        }
        if (experience.modifier !== EXPERIENCE_MODIFIER) {
          errors.push(
            err(
              7,
              'experienceModifier',
              `starting Experiences are +${EXPERIENCE_MODIFIER} (got ${experience.modifier})`,
              'experiences',
            ),
          );
        }
      }
      const names = experiences.map((e) => e.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) {
        errors.push(err(7, 'duplicateExperience', 'Experiences must be distinct', 'experiences'));
      }
      break;
    }

    case 8: {
      const { domainCardIds } = state;
      if (domainCardIds.length !== REQUIRED_DOMAIN_CARDS) {
        errors.push(
          err(
            8,
            'domainCardCount',
            `choose exactly ${REQUIRED_DOMAIN_CARDS} domain cards (got ${domainCardIds.length})`,
            'domainCardIds',
          ),
        );
      }
      if (new Set(domainCardIds).size !== domainCardIds.length) {
        errors.push(err(8, 'duplicateDomainCard', 'domain cards must be distinct', 'domainCardIds'));
      }
      for (const id of domainCardIds) {
        const card = findDomainCard(id);
        if (card === null) {
          errors.push(err(8, 'unknownDomainCard', `unknown domain card: ${id}`, 'domainCardIds'));
          continue;
        }
        if (card.level !== 1) {
          errors.push(
            err(
              8,
              'domainCardLevel',
              `${card.name} is level ${card.level}; a new character takes level 1 cards`,
              'domainCardIds',
            ),
          );
        }
        if (characterClass !== null && !characterClass.domains.includes(card.domain)) {
          errors.push(
            err(
              8,
              'domainCardOutOfDomain',
              `${card.name} is a ${card.domain} card; ${characterClass.name} has ${characterClass.domains.join(' and ')}`,
              'domainCardIds',
            ),
          );
        }
      }
      break;
    }

    case 9:
      // Connections are optional: "it's okay if there isn't an established connection
      // between every pair of PCs" (SRD p.4). Only their contents are checked.
      for (const connection of state.connections) {
        if (connection.withCharacter.trim() === '' || connection.description.trim() === '') {
          errors.push(
            err(9, 'emptyConnection', 'a connection needs a character and a description', 'connections'),
          );
        }
      }
      break;
  }

  return result(errors);
}

/** Validates every step. Used by `finalize` and to recompute completion flags. */
export function validateAll(state: CreationState): ValidationResult {
  const errors = ([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).flatMap(
    (step) => validateStep(state, step).errors,
  );
  return result(errors);
}
