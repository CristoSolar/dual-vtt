import { z } from 'zod';

import enAdversaries from '../data/en/adversaries.json' with { type: 'json' };
import enAncestries from '../data/en/ancestries.json' with { type: 'json' };
import enArmor from '../data/en/armor.json' with { type: 'json' };
import enBeastforms from '../data/en/beastforms.json' with { type: 'json' };
import enClasses from '../data/en/classes.json' with { type: 'json' };
import enCommunities from '../data/en/communities.json' with { type: 'json' };
import enConsumables from '../data/en/consumables.json' with { type: 'json' };
import enDomainCards from '../data/en/domain-cards.json' with { type: 'json' };
import enDomains from '../data/en/domains.json' with { type: 'json' };
import enEnvironments from '../data/en/environments.json' with { type: 'json' };
import enLoot from '../data/en/loot.json' with { type: 'json' };
import enSubclasses from '../data/en/subclasses.json' with { type: 'json' };
import enWeapons from '../data/en/weapons.json' with { type: 'json' };
import esAdversaries from '../data/es/adversaries.json' with { type: 'json' };
import esAncestries from '../data/es/ancestries.json' with { type: 'json' };
import esArmor from '../data/es/armor.json' with { type: 'json' };
import esBeastforms from '../data/es/beastforms.json' with { type: 'json' };
import esClasses from '../data/es/classes.json' with { type: 'json' };
import esCommunities from '../data/es/communities.json' with { type: 'json' };
import esConsumables from '../data/es/consumables.json' with { type: 'json' };
import esDomainCards from '../data/es/domain-cards.json' with { type: 'json' };
import esDomains from '../data/es/domains.json' with { type: 'json' };
import esEnvironments from '../data/es/environments.json' with { type: 'json' };
import esLoot from '../data/es/loot.json' with { type: 'json' };
import esSubclasses from '../data/es/subclasses.json' with { type: 'json' };
import esWeapons from '../data/es/weapons.json' with { type: 'json' };

import {
  AdversarySchema,
  AncestrySchema,
  ArmorSchema,
  BeastformSchema,
  CharacterClassSchema,
  CommunitySchema,
  DomainCardSchema,
  DomainSchema,
  EnvironmentSchema,
  ItemSchema,
  SubclassSchema,
  WeaponSchema,
} from './schemas.js';

export * from './core.js';
export * from './schemas.js';

export const LOCALES = ['en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

const schemas = {
  domains: z.array(DomainSchema),
  classes: z.array(CharacterClassSchema),
  subclasses: z.array(SubclassSchema),
  ancestries: z.array(AncestrySchema),
  communities: z.array(CommunitySchema),
  weapons: z.array(WeaponSchema),
  armor: z.array(ArmorSchema),
  domainCards: z.array(DomainCardSchema),
  adversaries: z.array(AdversarySchema),
  environments: z.array(EnvironmentSchema),
  loot: z.array(ItemSchema),
  consumables: z.array(ItemSchema),
  beastforms: z.array(BeastformSchema),
} as const;

type Raw = Record<keyof typeof schemas, unknown>;

const raw: Record<Locale, Raw> = {
  en: {
    domains: enDomains,
    classes: enClasses,
    subclasses: enSubclasses,
    ancestries: enAncestries,
    communities: enCommunities,
    weapons: enWeapons,
    armor: enArmor,
    domainCards: enDomainCards,
    adversaries: enAdversaries,
    environments: enEnvironments,
    loot: enLoot,
    consumables: enConsumables,
    beastforms: enBeastforms,
  },
  es: {
    domains: esDomains,
    classes: esClasses,
    subclasses: esSubclasses,
    ancestries: esAncestries,
    communities: esCommunities,
    weapons: esWeapons,
    armor: esArmor,
    domainCards: esDomainCards,
    adversaries: esAdversaries,
    environments: esEnvironments,
    loot: esLoot,
    consumables: esConsumables,
    beastforms: esBeastforms,
  },
};

/** File name on disk for each dataset key, so `validate` can report by path. */
const fileNames: Record<keyof typeof schemas, string> = {
  domains: 'domains.json',
  classes: 'classes.json',
  subclasses: 'subclasses.json',
  ancestries: 'ancestries.json',
  communities: 'communities.json',
  weapons: 'weapons.json',
  armor: 'armor.json',
  domainCards: 'domain-cards.json',
  adversaries: 'adversaries.json',
  environments: 'environments.json',
  loot: 'loot.json',
  consumables: 'consumables.json',
  beastforms: 'beastforms.json',
};

const datasetKeys = Object.keys(schemas) as (keyof typeof schemas)[];

/**
 * Every JSON file in every locale, paired with the schema it must satisfy.
 * `validate` walks this list; `srdByLocale` below reuses the same schemas.
 */
export const datasets = LOCALES.flatMap((locale) =>
  datasetKeys.map((key) => ({
    name: `${locale}/${fileNames[key]}`,
    schema: schemas[key] as z.ZodTypeAny,
    raw: raw[locale][key],
  })),
);

export type SrdData = { [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]> };

function parseLocale(locale: Locale): SrdData {
  const out: Partial<SrdData> = {};
  for (const key of datasetKeys) {
    // Each key's schema is the array schema for that key; the cast just re-attaches
    // the mapped type TypeScript loses in the loop.
    (out as Record<string, unknown>)[key] = schemas[key].parse(raw[locale][key]);
  }
  return out as SrdData;
}

/** Both locales, parsed once at import so a malformed JSON fails the process. */
export const srdByLocale: Record<Locale, SrdData> = {
  en: parseLocale('en'),
  es: parseLocale('es'),
};

// ponytail: module-level locale; thread a param through the reducers if this ever
// needs to be per-call. Every consumer reads `srd()` at call time, never at import.
let currentLocale: Locale = 'es';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** The SRD content for the active locale. Call at use time, never cache the result. */
export function srd(): SrdData {
  return srdByLocale[currentLocale];
}
