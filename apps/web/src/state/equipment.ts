/**
 * Pure helpers for the equipment step (wizard step 5): which trait a weapon
 * rolls with for this character, which weapons suit them, and the glyph drawn
 * on a card that has no art yet. Legality is not decided here — the list comes
 * from `availableOptions(state, 5)` in `@daggerheart/character`, which already
 * drops non-Tier-1 gear, magic weapons without a Spellcast trait, and every
 * secondary once a two-handed primary is chosen. This only orders and flags.
 */
import type { Trait } from '@daggerheart/character';
import type { Armor, Weapon } from '@daggerheart/srd-data';

export type Traits = Readonly<Record<Trait, number>>;

/** The trait a weapon rolls with: `spellcast` resolves to the subclass's trait. */
export function weaponTrait(weapon: Weapon, spellcast: Trait | null): Trait | null {
  return weapon.trait === 'spellcast' ? spellcast : weapon.trait;
}

/**
 * The character's strongest traits: every trait at or above the second-highest
 * value. With the standard array (+2 +1 +1 0 0 −1) that is the +2 and both +1s —
 * the two highest values, without picking a winner between tied traits.
 */
export function topTraits(traits: Traits | null): readonly Trait[] {
  if (traits === null) return [];
  const values = Object.values(traits).sort((a, b) => b - a);
  const floor = values[1] ?? values[0];
  if (floor === undefined) return [];
  return (Object.keys(traits) as Trait[]).filter((trait) => traits[trait] >= floor);
}

export type RecommendReason = 'spellcast' | 'topTrait';

export interface RankedWeapon {
  weapon: Weapon;
  /** The trait it rolls with for this character; null if that can't be known yet. */
  trait: Trait | null;
  /** The character's modifier in that trait; null before traits are assigned. */
  modifier: number | null;
  /** Why it's recommended, or null if it isn't. */
  reason: RecommendReason | null;
}

/** Why `weapon` suits this character, or null. Spellcast wins when both apply. */
export function recommendReason(
  weapon: Weapon,
  traits: Traits | null,
  spellcast: Trait | null,
): RecommendReason | null {
  const trait = weaponTrait(weapon, spellcast);
  if (trait === null) return null;
  if (spellcast !== null && trait === spellcast) return 'spellcast';
  return topTraits(traits).includes(trait) ? 'topTrait' : null;
}

/**
 * `weapons` annotated and ordered: recommended first, then by the character's
 * modifier in the weapon's trait (highest first); ties keep the SRD order.
 */
export function rankWeapons(
  weapons: readonly Weapon[],
  traits: Traits | null,
  spellcast: Trait | null,
): RankedWeapon[] {
  return weapons
    .map((weapon, index) => {
      const trait = weaponTrait(weapon, spellcast);
      const modifier = trait !== null && traits !== null ? traits[trait] : null;
      return { index, ranked: { weapon, trait, modifier, reason: recommendReason(weapon, traits, spellcast) } };
    })
    .sort(
      (a, b) =>
        Number(b.ranked.reason !== null) - Number(a.ranked.reason !== null) ||
        (b.ranked.modifier ?? 0) - (a.ranked.modifier ?? 0) ||
        a.index - b.index,
    )
    .map(({ ranked }) => ranked);
}

export type GearGlyph =
  | 'sword'
  | 'dagger'
  | 'axe'
  | 'hammer'
  | 'polearm'
  | 'bow'
  | 'crossbow'
  | 'staff'
  | 'wand'
  | 'shield'
  | 'fist'
  | 'whip'
  | 'rune'
  | 'chakram'
  | 'firearm'
  | 'wheel'
  | 'cloak'
  | 'robe'
  | 'tunic'
  | 'plate';

/**
 * Matched against the weapon id, which is the same in every locale. First match
 * wins, so the specific words come before the generic ones ("hand-crossbow"
 * before "bow", "casting-dagger" before "staff").
 */
const WEAPON_GLYPHS: readonly [RegExp, GearGlyph][] = [
  [/wheelchair/, 'wheel'],
  [/shield/, 'shield'],
  [/cloak/, 'cloak'],
  [/crossbow/, 'crossbow'],
  [/bow/, 'bow'],
  [/pistol|rifle/, 'firearm'],
  [/chakram/, 'chakram'],
  [/dagger|knife|knives/, 'dagger'],
  [/knuckles|gauntlet/, 'fist'],
  [/rings|runes/, 'rune'],
  [/whip(?!sword)|rope|grappler/, 'whip'],
  [/axe|hatchet/, 'axe'],
  [/hammer|mace/, 'hammer'],
  [/spear|halberd/, 'polearm'],
  [/staff/, 'staff'],
  [/wand|scepter/, 'wand'],
  [/sword|blade|katana|rapier|cutlass|scimitar/, 'sword'],
];

/** The glyph a weapon id names outright, or null if the id says nothing useful. */
export function glyphFromId(id: string): GearGlyph | null {
  return WEAPON_GLYPHS.find(([pattern]) => pattern.test(id))?.[1] ?? null;
}

/** The glyph on a weapon card with no art: by id, else by range and damage. */
export function weaponGlyph(weapon: Pick<Weapon, 'id' | 'range' | 'damageType'>): GearGlyph {
  const named = glyphFromId(weapon.id);
  if (named !== null) return named;
  if (weapon.range === 'far' || weapon.range === 'veryFar') {
    return weapon.damageType === 'physical' ? 'bow' : 'wand';
  }
  return weapon.damageType === 'physical' ? 'sword' : 'rune';
}

/** The glyph on an armor card with no art: robe, light, or heavy by Armor Score. */
export function armorGlyph(armor: Pick<Armor, 'id' | 'baseScore'>): GearGlyph {
  if (/robe/.test(armor.id) || armor.baseScore <= 2) return 'robe';
  return armor.baseScore >= 4 ? 'plate' : 'tunic';
}
