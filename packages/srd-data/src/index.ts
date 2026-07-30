import { z } from 'zod';

import adversariesJson from '../data/adversaries.json' with { type: 'json' };
import ancestriesJson from '../data/ancestries.json' with { type: 'json' };
import armorJson from '../data/armor.json' with { type: 'json' };
import beastformsJson from '../data/beastforms.json' with { type: 'json' };
import classesJson from '../data/classes.json' with { type: 'json' };
import communitiesJson from '../data/communities.json' with { type: 'json' };
import consumablesJson from '../data/consumables.json' with { type: 'json' };
import domainCardsJson from '../data/domain-cards.json' with { type: 'json' };
import domainsJson from '../data/domains.json' with { type: 'json' };
import environmentsJson from '../data/environments.json' with { type: 'json' };
import lootJson from '../data/loot.json' with { type: 'json' };
import subclassesJson from '../data/subclasses.json' with { type: 'json' };
import weaponsJson from '../data/weapons.json' with { type: 'json' };

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

/**
 * Every JSON file, paired with the schema it must satisfy. `validate` walks this
 * list; the typed exports below reuse the same parse so there is one source of truth.
 */
export const datasets = [
  { name: 'domains.json', schema: z.array(DomainSchema), raw: domainsJson },
  { name: 'classes.json', schema: z.array(CharacterClassSchema), raw: classesJson },
  { name: 'subclasses.json', schema: z.array(SubclassSchema), raw: subclassesJson },
  { name: 'ancestries.json', schema: z.array(AncestrySchema), raw: ancestriesJson },
  { name: 'communities.json', schema: z.array(CommunitySchema), raw: communitiesJson },
  { name: 'weapons.json', schema: z.array(WeaponSchema), raw: weaponsJson },
  { name: 'armor.json', schema: z.array(ArmorSchema), raw: armorJson },
  { name: 'domain-cards.json', schema: z.array(DomainCardSchema), raw: domainCardsJson },
  { name: 'adversaries.json', schema: z.array(AdversarySchema), raw: adversariesJson },
  { name: 'environments.json', schema: z.array(EnvironmentSchema), raw: environmentsJson },
  { name: 'loot.json', schema: z.array(ItemSchema), raw: lootJson },
  { name: 'consumables.json', schema: z.array(ItemSchema), raw: consumablesJson },
  { name: 'beastforms.json', schema: z.array(BeastformSchema), raw: beastformsJson },
] as const;

export const domains = z.array(DomainSchema).parse(domainsJson);
export const classes = z.array(CharacterClassSchema).parse(classesJson);
export const subclasses = z.array(SubclassSchema).parse(subclassesJson);
export const ancestries = z.array(AncestrySchema).parse(ancestriesJson);
export const communities = z.array(CommunitySchema).parse(communitiesJson);
export const weapons = z.array(WeaponSchema).parse(weaponsJson);
export const armor = z.array(ArmorSchema).parse(armorJson);
export const domainCards = z.array(DomainCardSchema).parse(domainCardsJson);
export const adversaries = z.array(AdversarySchema).parse(adversariesJson);
export const environments = z.array(EnvironmentSchema).parse(environmentsJson);
export const loot = z.array(ItemSchema).parse(lootJson);
export const consumables = z.array(ItemSchema).parse(consumablesJson);
export const beastforms = z.array(BeastformSchema).parse(beastformsJson);
