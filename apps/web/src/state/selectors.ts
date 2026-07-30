import type { Character } from '@daggerheart/character';
import {
  ancestries,
  armor as allArmor,
  classes,
  communities,
  domainCards,
  formatDice,
  formatModifier,
  subclasses,
  weapons,
  type Armor,
  type DomainCard,
  type Feature,
  type Trait,
  type Weapon,
} from '@daggerheart/srd-data';
import { TRAITS } from '@daggerheart/rules';

import type { SheetState } from './sheet.js';

/** Everything the sheet needs to render, resolved from ids once. */
export interface SheetView {
  className: string;
  subclassName: string;
  spellcastTrait: Trait | null;
  heritageLabel: string;
  communityName: string;
  classFeatures: readonly Feature[];
  hopeFeature: Feature;
  subclassFeatures: readonly Feature[];
  ancestryFeatures: readonly Feature[];
  communityFeature: Feature;
  primaryWeapon: Weapon | null;
  secondaryWeapon: Weapon | null;
  armor: Armor | null;
  loadout: readonly DomainCard[];
  vault: readonly DomainCard[];
  traits: readonly { trait: Trait; label: string; modifier: number }[];
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Assembles the display model for a sheet. Pure; no component does its own lookups. */
export function selectSheetView(sheet: SheetState): SheetView {
  const character = sheet.character;
  const characterClass = classes.find((c) => c.id === character.classId);
  const subclass = subclasses.find((s) => s.id === character.subclassId);
  const community = communities.find((c) => c.id === character.communityId);

  const heritage = character.heritage;
  const ancestryFeatures: Feature[] = [];
  let heritageLabel = '';

  if (heritage.kind === 'single') {
    const ancestry = ancestries.find((a) => a.id === heritage.ancestryId);
    heritageLabel = ancestry?.name ?? heritage.ancestryId;
    for (const feature of ancestry?.features ?? []) {
      ancestryFeatures.push({ name: feature.name, text: feature.text });
    }
  } else {
    const first = ancestries.find((a) => a.id === heritage.first.ancestryId);
    const second = ancestries.find((a) => a.id === heritage.second.ancestryId);
    heritageLabel = `${first?.name ?? heritage.first.ancestryId} / ${
      second?.name ?? heritage.second.ancestryId
    }`;
    const firstFeature = first?.features.find((f) => f.slot === heritage.first.slot);
    const secondFeature = second?.features.find((f) => f.slot === heritage.second.slot);
    if (firstFeature) ancestryFeatures.push({ name: firstFeature.name, text: firstFeature.text });
    if (secondFeature) ancestryFeatures.push({ name: secondFeature.name, text: secondFeature.text });
  }

  const byId = (ids: readonly string[]): DomainCard[] =>
    ids
      .map((id) => domainCards.find((c) => c.id === id))
      .filter((c): c is DomainCard => c !== undefined);

  return {
    className: characterClass?.name ?? character.classId,
    subclassName: subclass?.name ?? character.subclassId,
    spellcastTrait: subclass?.spellcastTrait ?? null,
    heritageLabel,
    communityName: community?.name ?? character.communityId,
    classFeatures: characterClass?.features ?? [],
    hopeFeature: characterClass?.hopeFeature ?? { name: '', text: '' },
    subclassFeatures: subclass?.foundation ?? [],
    ancestryFeatures,
    communityFeature: community?.feature ?? { name: '', text: '' },
    primaryWeapon: weapons.find((w) => w.id === character.equipment.primaryWeaponId) ?? null,
    secondaryWeapon:
      character.equipment.secondaryWeaponId === null
        ? null
        : weapons.find((w) => w.id === character.equipment.secondaryWeaponId) ?? null,
    armor: allArmor.find((a) => a.id === character.equipment.armorId) ?? null,
    loadout: byId(sheet.loadout),
    vault: byId(sheet.vault),
    traits: TRAITS.map((trait) => ({
      trait,
      label: titleCase(trait),
      modifier: character.traits[trait],
    })),
  };
}

/** The Recall Cost of a vaulted card, needed to price a swap outside a rest. */
export function recallCostOf(cardId: string): number {
  return domainCards.find((c) => c.id === cardId)?.recallCost ?? 0;
}

/**
 * The damage a weapon deals for this character: Proficiency multiplies the dice
 * count, never the flat modifier (SRD p.39).
 */
export function weaponDamage(weapon: Weapon, character: Character) {
  return {
    dice: { count: weapon.damage.count, die: weapon.damage.die },
    proficiency: character.proficiency,
    modifier: weapon.damage.modifier,
  };
}

/** "1d8+3" for the printed damage, and the rolled expression at this Proficiency. */
export function describeWeaponDamage(weapon: Weapon, character: Character): string {
  return formatDice({
    count: weapon.damage.count * character.proficiency,
    die: weapon.damage.die,
    modifier: weapon.damage.modifier,
  });
}

export const formatSigned = formatModifier;

/** Range and burden read better spaced out than camel-cased. */
const SPACED: Record<string, string> = {
  melee: 'Melee',
  veryClose: 'Very Close',
  close: 'Close',
  far: 'Far',
  veryFar: 'Very Far',
  oneHanded: 'One-Handed',
  twoHanded: 'Two-Handed',
  physical: 'Physical',
  magic: 'Magic',
  physicalOrMagic: 'Physical or Magic',
};

export const label = (value: string): string => SPACED[value] ?? titleCase(value);
