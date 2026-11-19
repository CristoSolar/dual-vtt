import { srd, type DomainCardType } from '@daggerheart/srd-data';

import { t, type MessageKey } from '../i18n/index.js';

/** A domain's localized name, from the SRD data of the current locale. */
export function domainName(id: string): string {
  return srd().domains.find((d) => d.id === id)?.name ?? id;
}

/** The first sentence of a domain's SRD description — a one-line header blurb. */
export function domainSummary(id: string): string {
  const text = srd().domains.find((d) => d.id === id)?.text ?? '';
  return firstSentence(text);
}

export function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end === -1 ? text.trim() : text.slice(0, end + 1).trim();
}

const CARD_TYPE_KEYS: Record<DomainCardType, MessageKey> = {
  ability: 'compendium.cardType.ability',
  spell: 'compendium.cardType.spell',
  grimoire: 'compendium.cardType.grimoire',
};

/** Ability / Spell / Grimoire, localized. */
export function cardTypeLabel(type: DomainCardType): string {
  return t(CARD_TYPE_KEYS[type]);
}

export interface DomainGroup<C> {
  domain: string;
  cards: C[];
}

/**
 * Splits cards into one group per domain, in `order` first (a class's own domains,
 * as the class lists them) and any other domain after, in first-seen order. Inside
 * a group cards run by level, then by name in the current locale.
 */
export function groupCardsByDomain<C extends { domain: string; level: number; name: string }>(
  cards: readonly C[],
  order: readonly string[] = [],
): DomainGroup<C>[] {
  const byDomain = new Map<string, C[]>();
  for (const domain of order) byDomain.set(domain, []);
  for (const card of cards) {
    const list = byDomain.get(card.domain);
    if (list === undefined) byDomain.set(card.domain, [card]);
    else list.push(card);
  }
  const groups: DomainGroup<C>[] = [];
  for (const [domain, list] of byDomain) {
    if (list.length === 0) continue;
    list.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
    groups.push({ domain, cards: list });
  }
  return groups;
}
