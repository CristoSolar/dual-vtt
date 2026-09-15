import type { SrdData } from '@daggerheart/srd-data';

/** One of the 13 SRD arrays the compendium browses. */
export type CollectionKey = keyof SrdData;

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
];

export const isCollection = (value: string | undefined): value is CollectionKey =>
  value !== undefined && (COLLECTIONS as readonly string[]).includes(value);
