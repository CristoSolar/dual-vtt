import { ClassIdSchema, DomainIdSchema, TraitSchema } from '@daggerheart/srd-data';
import { z } from 'zod';

/** The nine character creation steps (SRD p.4-7). */
export const STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export type Step = (typeof STEPS)[number];

/**
 * A heritage is either a single ancestry or a Mixed Ancestry taking the first-listed
 * feature from one ancestry and the second-listed from another (SRD p.31).
 */
export const AncestrySlotSchema = z.enum(['first', 'second']);

/** One ancestry feature picked for a Mixed Ancestry, identified by its slot. */
export const AncestryPickSchema = z.object({
  ancestryId: z.string().min(1),
  slot: AncestrySlotSchema,
});
export type AncestryPick = z.infer<typeof AncestryPickSchema>;

export const HeritageSchema = z.union([
  z.object({ kind: z.literal('single'), ancestryId: z.string().min(1) }),
  z.object({
    kind: z.literal('mixed'),
    /**
     * The two picks are stored with their slots so an illegal combination — two
     * first-listed features, say — is representable and can be reported by
     * `validateStep`, rather than being silently impossible to express.
     */
    first: AncestryPickSchema,
    second: AncestryPickSchema,
  }),
]);
export type Heritage = z.infer<typeof HeritageSchema>;

/** EITHER a Minor Health Potion OR a Minor Stamina Potion (SRD p.6). */
export const PotionChoiceSchema = z.enum(['health', 'stamina']);
export type PotionChoice = z.infer<typeof PotionChoiceSchema>;

export const EquipmentSchema = z.object({
  primaryWeaponId: z.string().min(1),
  /** Null when the primary weapon is two-handed. */
  secondaryWeaponId: z.string().min(1).nullable(),
  armorId: z.string().min(1),
  potion: PotionChoiceSchema,
  /** One of the two options listed in the class's `classItems`. */
  classItem: z.string().min(1),
  /**
   * "Whichever class-specific item you selected to carry your spells" (SRD p.6).
   * The SRD leaves the item itself to the player, so this is free text, required
   * only when the chosen subclass has a Spellcast trait.
   */
  spellCarrier: z.string().min(1).nullable(),
});
export type Equipment = z.infer<typeof EquipmentSchema>;

export const ExperienceSchema = z.object({
  name: z.string().min(1),
  modifier: z.number().int(),
});
export type Experience = z.infer<typeof ExperienceSchema>;

/** A relationship between this PC and another (SRD p.7). */
export const ConnectionSchema = z.object({
  /** The other PC this connection is with. */
  withCharacter: z.string().min(1),
  description: z.string().min(1),
});
export type Connection = z.infer<typeof ConnectionSchema>;

/**
 * The level-up advancement options, mirroring the rules package's `Advancement`
 * union so a finalized character is assignable to its `Character` type. A new
 * character has taken none of them; the field exists so `levelUp` can consume the
 * character unchanged.
 */
export const AdvancementSchema = z.enum([
  'traits',
  'hitPoint',
  'stress',
  'experience',
  'domainCard',
  'evasion',
  'subclass',
  'proficiency',
  'multiclass',
]);

/**
 * Multiclassing grants an additional class, access to one of its domains, and a
 * foundation card from one of its subclasses (SRD p.43). Mirrors the rules package's
 * `Multiclass` so a finalized character stays assignable to its `Character` type.
 */
export const MulticlassSchema = z.object({
  classId: ClassIdSchema,
  domainId: DomainIdSchema,
  subclassId: z.string().min(1),
});
export type Multiclass = z.infer<typeof MulticlassSchema>;

export const TraitAssignmentSchema = z.object({
  agility: z.number().int(),
  strength: z.number().int(),
  finesse: z.number().int(),
  instinct: z.number().int(),
  presence: z.number().int(),
  knowledge: z.number().int(),
});

/** In-progress creation. Every field a step has not filled in yet is null or empty. */
export const CreationStateSchema = z.object({
  currentStep: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
    z.literal(8),
    z.literal(9),
  ]),
  /** Which steps currently pass `validateStep`. Recomputed after every action. */
  completed: z.record(z.string(), z.boolean()),

  /** Fillable at any point during creation (SRD p.4). */
  name: z.string().nullable(),
  pronouns: z.string().nullable(),

  // Step 1. A draft holds whatever was chosen, valid or not, so `validateStep` can
  // report an unknown id instead of the reducer having to reject or coerce it.
  classId: z.string().nullable(),
  subclassId: z.string().nullable(),
  // Step 2
  heritage: HeritageSchema.nullable(),
  communityId: z.string().nullable(),
  // Step 3
  traits: TraitAssignmentSchema.nullable(),
  // Step 4 carries no choices: its values derive from the class.
  // Step 5
  equipment: EquipmentSchema.nullable(),
  // Step 6
  background: z.string().nullable(),
  // Step 7
  experiences: z.array(ExperienceSchema),
  // Step 8
  domainCardIds: z.array(z.string().min(1)),
  // Step 9
  connections: z.array(ConnectionSchema),
});
export type CreationState = z.infer<typeof CreationStateSchema>;

export type Trait = z.infer<typeof TraitSchema>;

/** Every choice a player can make. `applyChoice` is total over these. */
export type CreationAction =
  | { type: 'setName'; name: string }
  | { type: 'setPronouns'; pronouns: string }
  | { type: 'chooseClass'; classId: string }
  | { type: 'chooseSubclass'; subclassId: string }
  | { type: 'chooseAncestry'; ancestryId: string }
  | { type: 'chooseMixedAncestry'; first: AncestryPick; second: AncestryPick }
  | { type: 'chooseCommunity'; communityId: string }
  | { type: 'assignTraits'; traits: Record<Trait, number> }
  | { type: 'chooseEquipment'; equipment: Equipment }
  | { type: 'setBackground'; background: string }
  | { type: 'setExperiences'; experiences: readonly Experience[] }
  | { type: 'chooseDomainCards'; cardIds: readonly string[] }
  | { type: 'setConnections'; connections: readonly Connection[] }
  | { type: 'goToStep'; step: Step };

export interface ValidationError {
  step: Step;
  /** Stable machine-readable code; `message` is for humans. */
  code: string;
  message: string;
  /** The state field the error is about, when it maps to one. */
  field: string | null;
  /** Values the message interpolates, for localized rendering. */
  params?: Record<string, string | number>;
}

export type ValidationResult =
  | { ok: true; errors: readonly [] }
  | { ok: false; errors: readonly ValidationError[] };

/**
 * A finished character.
 *
 * `major`/`severe` and `thresholds` hold the same two numbers because the rules
 * package reads them both ways: `levelUp` takes flat `major`/`severe`, `applyDamage`
 * takes a `thresholds` object. Carrying both lets a finalized character be passed to
 * either without adaptation; `CharacterSchema` refuses any state where they disagree.
 */
export const CharacterSchema = z
  .object({
    /** The SRD lets a player fill this in at any point, so it may still be unset. */
    name: z.string().min(1).nullable(),
    pronouns: z.string().nullable(),

    classId: ClassIdSchema,
    subclassId: z.string().min(1),
    heritage: HeritageSchema,
    communityId: z.string().min(1),

    level: z.number().int().positive(),
    proficiency: z.number().int().positive(),
    evasion: z.number().int().nonnegative(),
    armorScore: z.number().int().nonnegative(),
    hpSlots: z.number().int().positive(),
    stressSlots: z.number().int().positive(),
    hope: z.number().int().nonnegative(),

    traits: TraitAssignmentSchema,
    /** Experience name -> modifier, in the shape the rules package expects. */
    experiences: z.record(z.string(), z.number().int()),
    markedTraits: z.array(z.string()),

    major: z.number().int(),
    severe: z.number().int(),
    thresholds: z.object({ major: z.number().int(), severe: z.number().int() }),

    domainCards: z.array(z.string().min(1)),
    multiclass: MulticlassSchema.nullable(),
    advancementsTaken: z.array(AdvancementSchema),

    equipment: EquipmentSchema,
    inventory: z.array(z.string().min(1)),
    background: z.string(),
    connections: z.array(ConnectionSchema),
  })
  .refine(
    (c) => c.major === c.thresholds.major && c.severe === c.thresholds.severe,
    'major/severe must match thresholds',
  );
export type Character = z.infer<typeof CharacterSchema>;
