import { classes, domainCards, weapons, type ClassId } from '@daggerheart/srd-data';

import {
  applyChoice,
  availableOptions,
  createInitialState,
  spellcastTrait,
  type CreationState,
  type Trait,
} from '../src/index.js';

/** A legal assignment of the +2/+1/+1/+0/+0/−1 array. */
export const VALID_TRAITS: Record<Trait, number> = {
  agility: 2,
  strength: 1,
  finesse: 1,
  instinct: 0,
  presence: 0,
  knowledge: -1,
};

/**
 * Drives the reducer through all nine steps for a class, picking the first legal
 * option at each one. Returns the state, so tests can assert on it or finalize it.
 */
export function buildCharacter(classId: ClassId, overrides: { subclassIndex?: 0 | 1 } = {}) {
  const characterClass = classes.find((c) => c.id === classId);
  if (!characterClass) throw new Error(`no such class: ${classId}`);

  let state: CreationState = createInitialState();

  // Step 1: class and subclass.
  state = applyChoice(state, { type: 'chooseClass', classId });
  const subclassId = characterClass.subclasses[overrides.subclassIndex ?? 0];
  if (subclassId === undefined) throw new Error(`no subclass for ${classId}`);
  state = applyChoice(state, { type: 'chooseSubclass', subclassId });

  // Step 2: heritage.
  state = applyChoice(state, { type: 'chooseAncestry', ancestryId: 'human' });
  state = applyChoice(state, { type: 'chooseCommunity', communityId: 'wanderborne' });

  // Step 3: traits.
  state = applyChoice(state, { type: 'assignTraits', traits: VALID_TRAITS });

  // Step 5: the first legal equipment for this class.
  const equipmentOptions = availableOptions(state, 5);
  const primary = equipmentOptions.primaryWeapons[0];
  const armorPiece = equipmentOptions.armor[0];
  const classItem = equipmentOptions.classItems[0];
  if (!primary || !armorPiece || !classItem) throw new Error('no equipment options');

  state = applyChoice(state, {
    type: 'chooseEquipment',
    equipment: {
      primaryWeaponId: primary.id,
      secondaryWeaponId: null,
      armorId: armorPiece.id,
      potion: 'health',
      classItem,
      spellCarrier: spellcastTrait(state) === null ? null : 'A worn leather spellbook',
    },
  });

  // Steps 6, 7, 9: narrative.
  state = applyChoice(state, { type: 'setName', name: `Test ${characterClass.name}` });
  state = applyChoice(state, { type: 'setBackground', background: 'Left home, never looked back.' });
  state = applyChoice(state, {
    type: 'setExperiences',
    experiences: [
      { name: 'Blacksmith', modifier: 2 },
      { name: 'Survivor', modifier: 2 },
    ],
  });

  // Step 8: two level-1 cards from this class's domains.
  const cards = availableOptions(state, 8).cards.slice(0, 2);
  state = applyChoice(state, { type: 'chooseDomainCards', cardIds: cards.map((c) => c.id) });

  state = applyChoice(state, {
    type: 'setConnections',
    connections: [{ withCharacter: 'Ilya', description: 'We survived the same winter.' }],
  });

  return state;
}

/** The first Tier 1 weapon matching a predicate, for equipment tests. */
export function tier1Weapon(predicate: (w: (typeof weapons)[number]) => boolean) {
  const found = weapons.find((w) => w.tier === 1 && predicate(w));
  if (!found) throw new Error('no matching Tier 1 weapon');
  return found;
}

/** All level-1 cards in a domain. */
export const level1CardsIn = (domain: string) =>
  domainCards.filter((c) => c.level === 1 && c.domain === domain);
