import {
  srd,
  type Ancestry,
  type Armor,
  type CharacterClass,
  type Community,
  type DomainCard,
  type Subclass,
  type Weapon,
} from '@daggerheart/srd-data';

import type { CreationState } from './types.js';

/** Characters are created at Tier 1 and can't equip gear above their tier (SRD p.44). */
export const STARTING_TIER = 1;

export const findClass = (id: string | null): CharacterClass | null =>
  srd().classes.find((c) => c.id === id) ?? null;

export const findSubclass = (id: string | null): Subclass | null =>
  srd().subclasses.find((s) => s.id === id) ?? null;

export const findAncestry = (id: string | null): Ancestry | null =>
  srd().ancestries.find((a) => a.id === id) ?? null;

export const findCommunity = (id: string | null): Community | null =>
  srd().communities.find((c) => c.id === id) ?? null;

export const findWeapon = (id: string | null): Weapon | null =>
  srd().weapons.find((w) => w.id === id) ?? null;

export const findArmor = (id: string | null): Armor | null =>
  srd().armor.find((a) => a.id === id) ?? null;

export const findDomainCard = (id: string | null): DomainCard | null =>
  srd().domainCards.find((c) => c.id === id) ?? null;

/**
 * The Spellcast trait comes from the subclass, and is null for every Guardian and
 * Warrior subclass. Magic weapons require one (SRD p.44).
 */
export function spellcastTrait(state: CreationState): Subclass['spellcastTrait'] | null {
  return findSubclass(state.subclassId)?.spellcastTrait ?? null;
}

export const canUseMagicWeapons = (state: CreationState): boolean =>
  spellcastTrait(state) !== null;

/** True for weapons whose use requires a Spellcast trait. */
export function requiresSpellcast(weapon: Weapon): boolean {
  // Arcane-frame combat wheelchairs use the subclass's Spellcast trait directly.
  return weapon.damageType !== 'physical' || weapon.trait === 'spellcast';
}

/**
 * The two options in a class's `classItems`, which the SRD prints as "X or Y"
 * (" o " in the Spanish data). Falls back to the whole string if it isn't a
 * two-way choice.
 */
export function classItemOptions(characterClass: CharacterClass): readonly string[] {
  const parts = characterClass.classItems.includes(' or ')
    ? characterClass.classItems.split(' or ')
    : characterClass.classItems.split(' o ');
  if (parts.length !== 2) return [characterClass.classItems];
  const [first, second] = parts;
  if (first === undefined || second === undefined) return [characterClass.classItems];
  // "A romance novel or a letter never opened" -> the second half keeps no article,
  // so both halves are used exactly as printed.
  return [first.trim(), second.trim()];
}
