import {
  ancestries,
  armor,
  classes,
  communities,
  domainCards,
  subclasses,
  weapons,
  type Ancestry,
  type Armor,
  type CharacterClass,
  type Community,
  type DomainCard,
  type Subclass,
  type Weapon,
} from '@daggerheart/srd-data';
import { STARTING_STRESS_SLOTS, TRAIT_ARRAY, TRAITS } from '@daggerheart/rules';

import {
  canUseMagicWeapons,
  classItemOptions,
  findClass,
  findWeapon,
  requiresSpellcast,
  STARTING_TIER,
} from './lookup.js';
import type { CreationState, PotionChoice, Step, Trait } from './types.js';

export interface ClassOptions {
  classes: readonly CharacterClass[];
  /** Empty until a class is chosen; then exactly that class's two subclasses. */
  subclasses: readonly Subclass[];
}

export interface HeritageOptions {
  ancestries: readonly Ancestry[];
  communities: readonly Community[];
  /** Ancestries that can supply the first-listed feature of a Mixed Ancestry. */
  mixedFirstSlot: readonly Ancestry[];
  /** Ancestries that can supply the second-listed feature of a Mixed Ancestry. */
  mixedSecondSlot: readonly Ancestry[];
}

export interface TraitOptions {
  traits: readonly Trait[];
  /** The modifiers to distribute, exactly (SRD p.5). */
  modifiers: readonly number[];
}

export interface DerivedStatsOptions {
  /** Step 4 records values rather than choosing them; null until a class is chosen. */
  derived: {
    level: number;
    proficiency: number;
    evasion: number;
    hpSlots: number;
    stressSlots: number;
    hope: number;
  } | null;
}

export interface EquipmentOptions {
  primaryWeapons: readonly Weapon[];
  /** Empty when the chosen primary is two-handed: no hand is left (SRD p.44). */
  secondaryWeapons: readonly Weapon[];
  armor: readonly Armor[];
  potions: readonly PotionChoice[];
  classItems: readonly string[];
  /** Whether this character carries spells and so needs a spell-carrier item. */
  needsSpellCarrier: boolean;
}

export interface BackgroundOptions {
  /**
   * The SRD's background questions are per-class flavor text that `srd-data` does
   * not carry, and players may write their own regardless (SRD p.7), so background
   * is free text.
   */
  freeText: true;
}

export interface ExperienceOptions {
  count: number;
  modifier: number;
  freeText: true;
}

export interface DomainCardOptions {
  /** Level-1 cards from the chosen class's two domains only. */
  cards: readonly DomainCard[];
  count: number;
}

export interface ConnectionOptions {
  freeText: true;
}

export interface StepOptions {
  1: ClassOptions;
  2: HeritageOptions;
  3: TraitOptions;
  4: DerivedStatsOptions;
  5: EquipmentOptions;
  6: BackgroundOptions;
  7: ExperienceOptions;
  8: DomainCardOptions;
  9: ConnectionOptions;
}

/** Every legal choice for the given step in the given state. */
export function availableOptions<S extends Step>(state: CreationState, step: S): StepOptions[S];
export function availableOptions(state: CreationState, step: Step): StepOptions[Step] {
  const characterClass = findClass(state.classId);

  switch (step) {
    case 1:
      return {
        classes,
        subclasses:
          characterClass === null
            ? []
            : subclasses.filter((s) => s.classId === characterClass.id),
      };

    case 2:
      return {
        ancestries,
        communities,
        mixedFirstSlot: ancestries.filter((a) => a.features.some((f) => f.slot === 'first')),
        mixedSecondSlot: ancestries.filter((a) => a.features.some((f) => f.slot === 'second')),
      };

    case 3:
      return { traits: TRAITS, modifiers: TRAIT_ARRAY };

    case 4:
      return {
        derived:
          characterClass === null
            ? null
            : {
                level: 1,
                proficiency: 1,
                evasion: characterClass.startingEvasion,
                hpSlots: characterClass.startingHP,
                stressSlots: STARTING_STRESS_SLOTS,
                hope: 2,
              },
      };

    case 5: {
      const magicAllowed = canUseMagicWeapons(state);
      const tier1 = weapons.filter((w) => w.tier === STARTING_TIER);
      const usable = tier1.filter((w) => magicAllowed || !requiresSpellcast(w));
      const primary = usable.filter((w) => w.category === 'primary');
      const chosenPrimary = findWeapon(state.equipment?.primaryWeaponId ?? null);

      return {
        primaryWeapons: primary,
        // A two-handed primary uses both hands, leaving none for a secondary.
        secondaryWeapons:
          chosenPrimary !== null && chosenPrimary.burden === 'twoHanded'
            ? []
            : usable.filter((w) => w.category === 'secondary'),
        armor: armor.filter((a) => a.tier === STARTING_TIER),
        potions: ['health', 'stamina'],
        classItems: characterClass === null ? [] : classItemOptions(characterClass),
        needsSpellCarrier: magicAllowed,
      };
    }

    case 6:
      return { freeText: true };

    case 7:
      return { count: 2, modifier: 2, freeText: true };

    case 8:
      return {
        cards:
          characterClass === null
            ? []
            : domainCards.filter(
                (c) => c.level === 1 && characterClass.domains.includes(c.domain),
              ),
        count: 2,
      };

    case 9:
      return { freeText: true };
  }
}
