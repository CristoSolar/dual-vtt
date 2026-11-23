import { spellcastTraitOf, type PrivateEntry, type RollEntry } from '@daggerheart/protocol';
import { srd, type CardAbility, type CardCost, type DomainCard } from '@daggerheart/srd-data';

import { t, type MessageKey } from '../i18n/index.js';
import { label as prettify } from './selectors.js';
import type { SheetState } from './sheet.js';

/**
 * Using a domain card: which of its abilities, what that costs, what it rolls.
 * Everything here reads the SRD card mechanics and the sheet; the server pays the
 * cost and rolls the dice, so nothing computed here is ever sent as a result.
 */

/** Labels on the wire are capped at 80 characters. */
const MAX_LABEL = 80;
const clip = (text: string) => (text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 1)}…`);

/** A card's abilities in the active language; a card with none recorded still has one. */
export function cardAbilities(cardId: string): readonly CardAbility[] {
  const abilities = srd().cardMechanics.find((entry) => entry.id === cardId)?.abilities;
  return abilities === undefined || abilities.length === 0 ? [{ name: null, roll: null }] : abilities;
}

/** "Libro de Tyfar — Llama Salvaje", or just the card's name for a single ability. */
export function abilityTitle(card: DomainCard, ability: CardAbility): string {
  return clip(ability.name === null ? card.name : `${card.name} — ${ability.name}`);
}

/** "Gasta 1 Esperanza", "Marca 2 de Estrés" — one phrase per thing paid. */
export function describeCost(cost: CardCost | undefined): string[] {
  if (cost === undefined) return [];
  const parts: string[] = [];
  if (cost.hope > 0) parts.push(t('cardUse.cost.hope', { count: cost.hope }));
  if (cost.stress > 0) parts.push(t('cardUse.cost.stress', { count: cost.stress }));
  if (cost.armor > 0) parts.push(t('cardUse.cost.armor', { count: cost.armor }));
  return parts;
}

/** What the sheet cannot pay of a cost, before asking the server: Hope and Armor Slots. */
export function costShortfall(sheet: SheetState, cost: CardCost | undefined): string | null {
  if (cost === undefined) return null;
  if (sheet.hope < cost.hope) return t('cardUse.notEnoughHope', { count: cost.hope });
  if (sheet.character.armorScore - sheet.armorSlotsMarked < cost.armor) return t('effect.noArmorSlots');
  return null;
}

/** The roll dialog for an ability's roll, or null when the ability has none. */
export interface CardRoll {
  title: string;
  modifiers: number;
  modifierLabel: string;
  /** The Difficulty the card prints, judged by the server; null leaves it to the GM or the target. */
  difficulty: number | null;
}

export function cardRoll(card: DomainCard, ability: CardAbility, sheet: SheetState): CardRoll | null {
  if (ability.roll === null) return null;
  const title = abilityTitle(card, ability);
  const difficulty = ability.difficulty ?? null;
  if (ability.roll === 'spellcast') {
    const trait = spellcastTraitOf(sheet);
    return {
      title,
      modifiers: trait === null ? 0 : sheet.character.traits[trait],
      modifierLabel:
        trait === null
          ? t('map.sheet.noTraitLabel')
          : t('sheet.route.spellcastTraitLabel', { trait: prettify(trait) }),
      difficulty,
    };
  }
  return {
    title,
    modifiers: sheet.character.traits[ability.roll],
    modifierLabel: prettify(ability.roll),
    difficulty,
  };
}

/** The `rollDamage` intent's dice for an ability, and how it reads on screen. */
export interface CardDamage {
  dice: { count: number; die: number };
  modifier: number;
  scale: 'proficiency' | 'spellcast' | 'none';
  /** "2d6+0 mágico" at this sheet's Proficiency or Spellcast trait. */
  text: string;
}

export function cardDamage(ability: CardAbility, sheet: SheetState): CardDamage | null {
  const damage = ability.damage;
  if (damage === undefined) return null;
  const trait = spellcastTraitOf(sheet);
  const times =
    damage.scale === 'proficiency'
      ? sheet.character.proficiency
      : damage.scale === 'spellcast'
        ? trait === null
          ? 0
          : Math.max(0, sheet.character.traits[trait])
        : 1;
  const count = damage.count * times;
  const mod = damage.modifier === 0 ? '' : `${damage.modifier > 0 ? '+' : '−'}${Math.abs(damage.modifier)}`;
  const type = damage.type === null ? '' : ` ${t(`damageType.${damage.type}` as MessageKey).toLowerCase()}`;
  return {
    dice: { count: damage.count, die: damage.die },
    modifier: damage.modifier,
    scale: damage.scale ?? 'none',
    text: `${count}d${damage.die}${mod}${type}`,
  };
}

/** The log label for an ability's damage roll. */
export function damageLabel(card: DomainCard, ability: CardAbility): string {
  return clip(t('sheet.roll.damageLabel', { title: abilityTitle(card, ability) }));
}

/** Every entry id currently in the logs, so the roll that lands next can be told apart. */
export function knownEntryIds(
  shared: readonly RollEntry[],
  privateEntries: readonly PrivateEntry[] = [],
): ReadonlySet<string> {
  return new Set([...shared.map((e) => e.id), ...privateEntries.map((p) => p.entry.id)]);
}

/**
 * The duality roll the server logged for this ability after `known` was taken: the
 * newest entry with its label that was not there before. Null until it lands.
 */
export function landedRoll(
  label: string,
  known: ReadonlySet<string>,
  shared: readonly RollEntry[],
  privateEntries: readonly PrivateEntry[] = [],
): Extract<RollEntry, { kind: 'duality' }> | null {
  for (const entry of [...shared, ...privateEntries.map((p) => p.entry)]) {
    if (entry.kind === 'duality' && entry.label === label && !known.has(entry.id)) return entry;
  }
  return null;
}
