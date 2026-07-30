import {
  applyChoice,
  availableOptions,
  createInitialState,
  finalize,
  spellcastTrait,
  type Character,
  type CreationState,
  type Trait,
} from '@daggerheart/character';
import { classes, type ClassId } from '@daggerheart/srd-data';

import type { StorageLike } from '../src/state/storage.js';

const TRAITS: Record<Trait, number> = {
  agility: 2,
  strength: 1,
  finesse: 1,
  instinct: 0,
  presence: 0,
  knowledge: -1,
};

/** Runs the creation reducer end to end, exactly as the wizard does. */
export function buildCreationState(classId: ClassId = 'guardian'): CreationState {
  const characterClass = classes.find((c) => c.id === classId);
  if (!characterClass) throw new Error(`no such class: ${classId}`);

  let state = createInitialState();
  state = applyChoice(state, { type: 'chooseClass', classId });

  const subclassId = characterClass.subclasses[0];
  if (subclassId === undefined) throw new Error('no subclass');
  state = applyChoice(state, { type: 'chooseSubclass', subclassId });
  state = applyChoice(state, { type: 'chooseAncestry', ancestryId: 'human' });
  state = applyChoice(state, { type: 'chooseCommunity', communityId: 'wanderborne' });
  state = applyChoice(state, { type: 'assignTraits', traits: TRAITS });

  const equipment = availableOptions(state, 5);
  const primary = equipment.primaryWeapons[0];
  const armorPiece = equipment.armor[0];
  const classItem = equipment.classItems[0];
  if (!primary || !armorPiece || !classItem) throw new Error('no equipment options');

  state = applyChoice(state, {
    type: 'chooseEquipment',
    equipment: {
      primaryWeaponId: primary.id,
      secondaryWeaponId: null,
      armorId: armorPiece.id,
      potion: 'health',
      classItem,
      spellCarrier: spellcastTrait(state) === null ? null : 'A worn spellbook',
    },
  });

  state = applyChoice(state, { type: 'setName', name: 'Test Character' });
  state = applyChoice(state, { type: 'setBackground', background: 'A long road.' });
  state = applyChoice(state, {
    type: 'setExperiences',
    experiences: [
      { name: 'Blacksmith', modifier: 2 },
      { name: 'Survivor', modifier: 2 },
    ],
  });

  const cards = availableOptions(state, 8).cards.slice(0, 2);
  state = applyChoice(state, { type: 'chooseDomainCards', cardIds: cards.map((c) => c.id) });
  state = applyChoice(state, { type: 'setConnections', connections: [] });

  return state;
}

export function buildCharacter(classId: ClassId = 'guardian'): Character {
  return finalize(buildCreationState(classId));
}

/** An in-memory stand-in for localStorage. */
export function fakeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}
