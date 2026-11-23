import { z } from 'zod';
import {
  ClassIdSchema,
  DamageTypeSchema,
  DiceSchema,
  DieSizeSchema,
  DomainIdSchema,
  FeatureSchema,
  RangeSchema,
  ThresholdsSchema,
  TierSchema,
  TraitSchema,
} from './core.js';

export const DomainSchema = z.object({
  id: DomainIdSchema,
  name: z.string().min(1),
  text: z.string().min(1),
  /**
   * Which classes can access this domain (SRD 2.0 p.7). Two in the core set; the
   * classes added in 2.0 take some domains to three.
   */
  classes: z.array(ClassIdSchema).min(2),
});
export type Domain = z.infer<typeof DomainSchema>;

export const CharacterClassSchema = z.object({
  id: ClassIdSchema,
  name: z.string().min(1),
  domains: z.array(DomainIdSchema).length(2),
  startingEvasion: z.number().int().positive(),
  startingHP: z.number().int().positive(),
  classItems: z.string().min(1),
  /** The class feature that costs 3 Hope to activate. */
  hopeFeature: FeatureSchema,
  features: z.array(FeatureSchema).min(1),
  subclasses: z.array(z.string().min(1)).length(2),
});
export type CharacterClass = z.infer<typeof CharacterClassSchema>;

export const SubclassSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  classId: ClassIdSchema,
  /** null for Guardian and Warrior subclasses, which have no Spellcast trait. */
  spellcastTrait: TraitSchema.nullable(),
  foundation: z.array(FeatureSchema).min(1),
  specialization: z.array(FeatureSchema).min(1),
  mastery: z.array(FeatureSchema).min(1),
});
export type Subclass = z.infer<typeof SubclassSchema>;

/**
 * Ancestry features are slot-ordered because Mixed Ancestry takes the first-listed
 * feature from one ancestry and the second-listed from another (SRD p.31).
 */
export const AncestrySlotSchema = z.enum(['first', 'second']);
export type AncestrySlot = z.infer<typeof AncestrySlotSchema>;

export const AncestrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  features: z
    .array(FeatureSchema.extend({ slot: AncestrySlotSchema }))
    .length(2)
    .refine(
      (f) => f[0]?.slot === 'first' && f[1]?.slot === 'second',
      'features must be ordered [first, second]',
    ),
});
export type Ancestry = z.infer<typeof AncestrySchema>;

export const CommunitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  feature: FeatureSchema,
});
export type Community = z.infer<typeof CommunitySchema>;

/**
 * Arcane-frame combat wheelchairs use "the Spellcast trait indicated by your
 * subclass" rather than a fixed trait (SRD p.55), so 'spellcast' is a valid value.
 */
export const WeaponTraitSchema = z.union([TraitSchema, z.literal('spellcast')]);
export type WeaponTrait = z.infer<typeof WeaponTraitSchema>;

/** The Ghostblade's Otherworldly feature lets the wielder pick, hence the third option. */
export const WeaponDamageTypeSchema = z.enum(['physical', 'magic', 'physicalOrMagic']);
export type WeaponDamageType = z.infer<typeof WeaponDamageTypeSchema>;

export const BurdenSchema = z.enum(['oneHanded', 'twoHanded']);
export type Burden = z.infer<typeof BurdenSchema>;

export const WeaponSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: TierSchema,
  category: z.enum(['primary', 'secondary']),
  trait: WeaponTraitSchema,
  range: RangeSchema,
  /**
   * The printed damage. `count` is always 1 on SRD weapons: Proficiency sets how
   * many dice you actually roll, and never touches `modifier`.
   */
  damage: DiceSchema,
  damageType: WeaponDamageTypeSchema,
  burden: BurdenSchema,
  feature: FeatureSchema.nullable(),
});
export type Weapon = z.infer<typeof WeaponSchema>;

export const ArmorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: TierSchema,
  /** Add the wearer's level to these to get the final thresholds (SRD p.56). */
  baseThresholds: ThresholdsSchema,
  baseScore: z.number().int().nonnegative(),
  feature: FeatureSchema.nullable(),
});
export type Armor = z.infer<typeof ArmorSchema>;

/**
 * Abilities are typically non-magical, spells are magical, and grimoires are unique
 * to the Codex domain (SRD p.8).
 */
export const DomainCardTypeSchema = z.enum(['ability', 'spell', 'grimoire']);
export type DomainCardType = z.infer<typeof DomainCardTypeSchema>;

export const DomainCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** You cannot acquire a domain card with a level higher than your PC's (SRD p.8). */
  level: z.number().int().min(1).max(10),
  domain: DomainIdSchema,
  type: DomainCardTypeSchema,
  /** Stress marked to swap this card from the vault into the loadout (SRD p.8). */
  recallCost: z.number().int().nonnegative(),
  text: z.string().min(1),
});
export type DomainCard = z.infer<typeof DomainCardSchema>;

/** What a card costs its user: Hope spent, Stress marked, Armor Slots marked. */
export const CardCostSchema = z.object({
  hope: z.number().int().nonnegative(),
  stress: z.number().int().nonnegative(),
  armor: z.number().int().nonnegative(),
});
export type CardCost = z.infer<typeof CardCostSchema>;

/**
 * Damage a card deals. `count` is the printed count; `scale` says what multiplies
 * it — "using your Proficiency" as weapons do, or "using your Spellcast trait".
 * `type` is null where the card prints none.
 */
export const CardDamageSchema = z.object({
  count: z.number().int().positive(),
  die: DieSizeSchema,
  modifier: z.number().int(),
  type: DamageTypeSchema.nullable(),
  scale: z.enum(['proficiency', 'spellcast']).nullable(),
});
export type CardDamage = z.infer<typeof CardDamageSchema>;

/**
 * One usable ability on a card: a grimoire spell, a named option, or the card
 * itself. Read from the card text (see `extract/gen-card-mechanics.mjs`); a card
 * with nothing mechanical still has one, with no roll, so it can be used.
 */
export const CardAbilitySchema = z.object({
  /** The sub-ability's printed name; null when it is the card itself. */
  name: z.string().min(1).nullable(),
  /** The user's roll: a Spellcast Roll, a trait roll, or none. */
  roll: WeaponTraitSchema.nullable(),
  /** The Difficulty the card prints, e.g. "Spellcast Roll (13)". */
  difficulty: z.number().int().positive().optional(),
  damage: CardDamageSchema.optional(),
  /** Paid on use. */
  cost: CardCostSchema.optional(),
  /** Paid only after the roll succeeds ("On a success, spend a Hope to…"). */
  successCost: CardCostSchema.optional(),
});
export type CardAbility = z.infer<typeof CardAbilitySchema>;

/** A domain card's abilities, keyed by the card's id. */
export const CardMechanicsSchema = z.object({
  id: z.string().min(1),
  abilities: z.array(CardAbilitySchema).min(1),
});
export type CardMechanics = z.infer<typeof CardMechanicsSchema>;

/**
 * Adversary and environment features are typed by how they're used (SRD 2.0 p.94).
 * `evolution` is new in 2.0: a one-shot feature an adversary gains mid-scene.
 */
export const StatBlockFeatureSchema = FeatureSchema.extend({
  type: z.enum(['action', 'reaction', 'passive', 'evolution']),
  /**
   * The SRD prints no separate "Fear" feature type; a Fear feature is an Action or
   * Reaction whose text requires spending Fear (SRD p.37). Derived from that text.
   */
  costsFear: z.boolean(),
});
export type StatBlockFeature = z.infer<typeof StatBlockFeatureSchema>;

/** Minions print flat damage with no dice, so `count` may be 0 and `die` null. */
export const StatBlockDamageSchema = z.object({
  count: z.number().int().nonnegative(),
  die: DieSizeSchema.nullable(),
  modifier: z.number().int(),
});

export const AdversarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: TierSchema,
  type: z.enum([
    'bruiser',
    'horde',
    'leader',
    'minion',
    'ranged',
    'skulk',
    'social',
    'solo',
    'standard',
    'support',
  ]),
  /** Hordes list the damage threshold at which they lose a unit, e.g. "(10/HP)". */
  hordeThreshold: z.number().int().positive().nullable(),
  description: z.string().min(1),
  motivesAndTactics: z.string().min(1),
  difficulty: z.number().int().positive(),
  /** Minions have no thresholds; a few adversaries have a Major but no Severe. */
  thresholds: z
    .object({
      major: z.number().int().positive(),
      severe: z.number().int().positive().nullable(),
    })
    .nullable(),
  hp: z.number().int().positive(),
  stress: z.number().int().nonnegative(),
  /** Usually flat; a few adversaries roll for it (e.g. "ATK: +2d4"). */
  attackModifier: z.object({
    flat: z.number().int().nullable(),
    roll: z.object({ count: z.number().int().positive(), die: DieSizeSchema }).nullable(),
  }),
  standardAttack: z.object({
    name: z.string().min(1),
    range: RangeSchema,
    damage: StatBlockDamageSchema,
    damageType: DamageTypeSchema,
    /** Direct damage can't be reduced by marking Armor Slots (SRD p.40). */
    direct: z.boolean(),
  }),
  experiences: z.array(z.object({ name: z.string().min(1), modifier: z.number().int() })),
  features: z.array(StatBlockFeatureSchema).min(1),
});
export type Adversary = z.infer<typeof AdversarySchema>;

export const EnvironmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: TierSchema,
  type: z.enum(['event', 'exploration', 'social', 'traversal']),
  description: z.string().min(1),
  impulses: z.string().min(1),
  /** A couple of environments derive their Difficulty from a feature instead. */
  difficulty: z.union([z.number().int().positive(), z.literal('special')]),
  potentialAdversaries: z.string().min(1),
  features: z.array(StatBlockFeatureSchema).min(1),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

/** Roll on the d12-based tables to generate a random item (SRD p.58). */
export const ItemSchema = z.object({
  /**
   * SRD 2.0 prints two independent d60 tables for each of loot and consumables, so
   * a roll alone no longer identifies a row: `table` says which one to roll on.
   */
  table: z.enum(['core', 'additional']),
  roll: z.number().int().min(1).max(60),
  id: z.string().min(1),
  name: z.string().min(1),
  text: z.string().min(1),
});
export type Item = z.infer<typeof ItemSchema>;

/**
 * A transformation (SRD 2.0 p.42), an optional card that trades a benefit for a
 * drawback. A character can carry only one, and it does not count against the
 * loadout maximum.
 */
export const TransformationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  features: z.array(FeatureSchema).min(1),
  /** Prompts the player answers when they take it. */
  questions: z.array(z.string().min(1)).min(1),
});
export type Transformation = z.infer<typeof TransformationSchema>;

export const BeastformSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tier: TierSchema,
  /** The example creatures printed in parentheses. */
  examples: z.string().min(1),
  /**
   * Upgrade options ("Legendary Beast", "Mythic Beast") improve a lower-tier form
   * instead of having their own statistics, so these are null for them.
   */
  trait: TraitSchema.nullable(),
  traitBonus: z.number().int().nullable(),
  evasionBonus: z.number().int().nullable(),
  attack: z
    .object({
      trait: TraitSchema,
      range: RangeSchema,
      damage: DiceSchema,
      damageType: DamageTypeSchema,
    })
    .nullable(),
  /** Actions this form gains advantage on, e.g. "climb", "sneak". */
  advantages: z.array(z.string().min(1)),
  features: z.array(FeatureSchema).min(1),
});
export type Beastform = z.infer<typeof BeastformSchema>;
