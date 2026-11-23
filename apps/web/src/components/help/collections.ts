import type { SrdData } from '@daggerheart/srd-data';

/**
 * One of the SRD arrays the compendium browses. Card mechanics are not one: they
 * have no name or text of their own, only what a card's text already says.
 */
export type CollectionKey = Exclude<keyof SrdData, 'cardMechanics'>;

export const COLLECTIONS: readonly CollectionKey[] = [
  'classes',
  'subclasses',
  'ancestries',
  'communities',
  'domains',
  'domainCards',
  'weapons',
  'armor',
  'adversaries',
  'environments',
  'loot',
  'consumables',
  'beastforms',
  'transformations',
];

export const isCollection = (value: string | undefined): value is CollectionKey =>
  value !== undefined && (COLLECTIONS as readonly string[]).includes(value);
