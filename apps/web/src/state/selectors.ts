import type { Character } from '@daggerheart/character';
import {
  formatDice,
  formatModifier,
  srd,
  type Armor,
  type DomainCard,
  type Feature,
  type Trait,
  type Weapon,
} from '@daggerheart/srd-data';
import { TRAITS } from '@daggerheart/rules';

import { t, type MessageKey } from '../i18n/index.js';
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
 * The three example uses the SRD prints under each trait, as a single key per
 * trait (`t()` joined by ` · `). They belong on the sheet, not just in the
 * rulebook: the plaque tells you what the trait is for without a lookup,
 * which is the whole point of a sheet you read mid-session.
 */
const TRAIT_USE_KEYS: Record<Trait, MessageKey> = {
  agility: 'trait.agilityUses',
  strength: 'trait.strengthUses',
  finesse: 'trait.finesseUses',
  instinct: 'trait.instinctUses',
  presence: 'trait.presenceUses',
  knowledge: 'trait.knowledgeUses',
};

/** Trait names, spelled out rather than title-cased from the English id. */
const TRAIT_LABEL_KEYS: Record<Trait, MessageKey> = {
  agility: 'trait.agility',
  strength: 'trait.strength',
  finesse: 'trait.finesse',
  instinct: 'trait.instinct',
  presence: 'trait.presence',
  knowledge: 'trait.knowledge',
};

/** Assembles the display model for a sheet. Pure; no component does its own lookups. */
export function selectSheetView(sheet: SheetState): SheetView {
  const character = sheet.character;
  const characterClass = srd().classes.find((c) => c.id === character.classId);
  const subclass = srd().subclasses.find((s) => s.id === character.subclassId);
  const community = srd().communities.find((c) => c.id === character.communityId);

  const heritage = character.heritage;
  const ancestryFeatures: Feature[] = [];
  let heritageLabel = '';

  if (heritage.kind === 'single') {
    const ancestry = srd().ancestries.find((a) => a.id === heritage.ancestryId);
    heritageLabel = ancestry?.name ?? heritage.ancestryId;
    for (const feature of ancestry?.features ?? []) {
      ancestryFeatures.push({ name: feature.name, text: feature.text });
    }
  } else {
    const first = srd().ancestries.find((a) => a.id === heritage.first.ancestryId);
    const second = srd().ancestries.find((a) => a.id === heritage.second.ancestryId);
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
      .map((id) => srd().domainCards.find((c) => c.id === id))
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
    primaryWeapon: srd().weapons.find((w) => w.id === character.equipment.primaryWeaponId) ?? null,
    secondaryWeapon:
      character.equipment.secondaryWeaponId === null
        ? null
        : srd().weapons.find((w) => w.id === character.equipment.secondaryWeaponId) ?? null,
    armor: srd().armor.find((a) => a.id === character.equipment.armorId) ?? null,
    loadout: byId(sheet.loadout),
    vault: byId(sheet.vault),
    traits: TRAITS.map((trait) => ({
      trait,
      label: t(TRAIT_LABEL_KEYS[trait]),
      modifier: character.traits[trait],
      uses: t(TRAIT_USE_KEYS[trait]).split(' · '),
    })),
  };
}

/** The Recall Cost of a vaulted card, needed to price a swap outside a rest. */
export function recallCostOf(cardId: string): number {
  return srd().domainCards.find((c) => c.id === cardId)?.recallCost ?? 0;
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

/** Range, burden, and damage-type ids, mapped to their localized label keys. */
const SPACED_KEYS: Record<string, MessageKey> = {
  melee: 'range.melee',
  veryClose: 'range.veryClose',
  close: 'range.close',
  far: 'range.far',
  veryFar: 'range.veryFar',
  oneHanded: 'burden.oneHanded',
  twoHanded: 'burden.twoHanded',
  physical: 'damageType.physical',
  magic: 'damageType.magic',
  physicalOrMagic: 'damageType.physicalOrMagic',
};

export const label = (value: string): string => {
  const traitKey = TRAIT_LABEL_KEYS[value as Trait];
  if (traitKey !== undefined) return t(traitKey);
  const spacedKey = SPACED_KEYS[value];
  if (spacedKey !== undefined) return t(spacedKey);
  return titleCase(value);
};
