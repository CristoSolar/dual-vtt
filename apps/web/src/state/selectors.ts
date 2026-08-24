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
  traits: readonly { trait: Trait; label: string; modifier: number; uses: readonly string[] }[];
}

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The three example uses the SRD prints under each trait. They belong on the
 * sheet, not just in the rulebook: the plaque tells you what the trait is for
 * without a lookup, which is the whole point of a sheet you read mid-session.
 */
const TRAIT_USES: Record<Trait, readonly string[]> = {
  agility: ['Correr', 'Esquivar', 'Saltar'],
  strength: ['Alzar', 'Golpear', 'Forcejear'],
  finesse: ['Controlar', 'Ocultar', 'Trastear'],
  instinct: ['Percibir', 'Sentir', 'Rastrear'],
  presence: ['Encantar', 'Actuar', 'Engañar'],
  knowledge: ['Recordar', 'Analizar', 'Comprender'],
};

/** Trait names, spelled out in Spanish rather than title-cased from the English id. */
const TRAIT_LABELS: Record<Trait, string> = {
  agility: 'Agilidad',
  strength: 'Fuerza',
  finesse: 'Destreza',
  instinct: 'Instinto',
  presence: 'Presencia',
  knowledge: 'Conocimiento',
};

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
      label: TRAIT_LABELS[trait],
      modifier: character.traits[trait],
      uses: TRAIT_USES[trait],
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
  melee: 'Cuerpo a cuerpo',
  veryClose: 'Muy cerca',
  close: 'Cerca',
  far: 'Lejos',
  veryFar: 'Muy lejos',
  oneHanded: 'Una mano',
  twoHanded: 'Dos manos',
  physical: 'Físico',
  magic: 'Mágico',
  physicalOrMagic: 'Físico o mágico',
};

export const label = (value: string): string =>
  TRAIT_LABELS[value as Trait] ?? SPACED[value] ?? titleCase(value);
