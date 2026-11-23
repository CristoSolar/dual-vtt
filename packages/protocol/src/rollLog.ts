import { z } from 'zod';

/**
 * The five outcomes of an action roll (SRD p.36), plus the two a roll has when
 * it was made without a Difficulty and the GM calls success at the table.
 */
export const ActionOutcomeSchema = z.enum([
  'criticalSuccess',
  'successHope',
  'successFear',
  'failureHope',
  'failureFear',
  'withHope',
  'withFear',
]);

export const DualityRollSchema = z.object({
  hope: z.number().int(),
  fear: z.number().int(),
  total: z.number().int(),
  /** The flat modifier folded into `total` — trait, Experience, and so on. */
  modifiers: z.number().int(),
  critical: z.boolean(),
  withHope: z.boolean(),
  advantageRoll: z.number().int().nullable(),
  disadvantageRoll: z.number().int().nullable(),
});

export const DamageRollSchema = z.object({
  rolls: z.array(z.number().int()),
  /** Faces on each die, for drawing them. Null on entries logged before it was kept. */
  die: z.number().int().nullable().default(null),
  criticalBonus: z.number().int(),
  modifier: z.number().int(),
  total: z.number().int(),
});

/** An adversary's d20 attack, which is the GM's equivalent of a duality roll. */
export const AdversaryAttackRollSchema = z.object({
  dice: z.array(z.number().int()),
  die: z.number().int(),
  modifier: z.number().int(),
  experience: z.number().int(),
  total: z.number().int(),
  critical: z.boolean(),
  success: z.boolean().nullable(),
});

/** The loose dice the tray offers, as Foundry's does: everything but the d12s of a duality roll. */
export const DICE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const;
export const DieSidesSchema = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
  z.literal(20),
  z.literal(100),
]);
export type DieSides = z.infer<typeof DieSidesSchema>;

/** Most dice of one size a single tray roll may throw. */
export const MAX_DICE_PER_GROUP = 20;

/**
 * Where a logged effect came from. `ref` is the SRD id of the card, class,
 * adversary or environment, so each client reads its text in its own language.
 */
export const EffectSourceSchema = z.enum([
  'hopeFeature',
  'domainCard',
  'adversaryFeature',
  'environmentFeature',
]);
export type EffectSource = z.infer<typeof EffectSourceSchema>;

/**
 * One entry in the shared roll log. `by` is the display name of whoever rolled, so
 * the whole table can see who did what.
 */
export const RollEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('duality'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    label: z.string().min(1),
    roll: DualityRollSchema,
    /** Null when the roll had no Difficulty: the GM judges success at the table. */
    difficulty: z.number().int().nullable(),
    outcome: ActionOutcomeSchema,
    experiences: z.array(z.string()),
    /** Reactions read differently: they earn no Hope or Fear. */
    reaction: z.boolean().default(false),
    /** The targeted token's name, when the roll was made against one. */
    target: z.string().nullable().default(null),
  }),
  z.object({
    kind: z.literal('attack'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    label: z.string().min(1),
    roll: AdversaryAttackRollSchema,
    /** The Evasion it was rolled against, when the target was known. */
    evasion: z.number().int().nullable(),
    /** Who it was aimed at, for the log to name. */
    target: z.string().nullable(),
  }),
  z.object({
    /**
     * A fate roll or a hazard the GM rolled: one number and the sentence that goes
     * with it (SRD 2.0 p.92). Kept apart from damage rolls because nothing here is
     * applied to anyone automatically.
     */
    kind: z.literal('fate'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    label: z.string().min(1),
    value: z.number().int(),
  }),
  z.object({
    kind: z.literal('damage'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    label: z.string().min(1),
    roll: DamageRollSchema,
    critical: z.boolean(),
  }),
  z.object({
    /**
     * A chat line. The log is the table's chat as well as its dice, so a message
     * sits among the rolls rather than in a panel of its own. `byId` is the
     * sender's account, which `by` (a display name) cannot stand in for.
     */
    kind: z.literal('message'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    byId: z.string().min(1),
    text: z.string().min(1).max(500),
  }),
  z.object({
    /** A row drawn from one of the GM's random tables. `label` names the table. */
    kind: z.literal('table'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    label: z.string().min(1),
    result: z.string().min(1),
    index: z.number().int(),
  }),
  z.object({
    /** Loose dice from the tray: any seat, any mix of sizes, plus a flat modifier. */
    kind: z.literal('dice'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    byId: z.string().min(1),
    label: z.string().min(1).max(60),
    groups: z
      .array(
        z.object({
          sides: DieSidesSchema,
          rolls: z.array(z.number().int().min(1).max(100)).min(1).max(MAX_DICE_PER_GROUP),
        }),
      )
      .min(1)
      .max(DICE_SIDES.length),
    modifier: z.number().int(),
    total: z.number().int(),
  }),
  z.object({
    /**
     * A feature or spell somebody used. Nothing is rolled; the entry says what was
     * used so the table can read it back. `title` is the name as the server read
     * it, for a client that cannot find `ref` in its own SRD data.
     */
    kind: z.literal('effect'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    byId: z.string().min(1),
    source: EffectSourceSchema,
    ref: z.string().min(1),
    /** The feature's place in its stat block, for adversary and environment features. */
    feature: z.number().int().min(0).nullable(),
    title: z.string().min(1),
  }),
]);
export type RollEntry = z.infer<typeof RollEntrySchema>;

/**
 * Who sees a roll. A player's private roll is theirs and the GM's; the GM's is the
 * GM's alone. There is no roll hidden from its own roller: a duality roll moves
 * Hope or Fear where everyone can see it.
 */
export const VisibilitySchema = z.enum(['public', 'private']);
export type Visibility = z.infer<typeof VisibilitySchema>;

/**
 * An entry only some accounts may see: a whisper or a private roll. The GM is
 * implied and never listed, so an empty audience means the GM alone.
 */
export const PrivateEntrySchema = z.object({
  audience: z.array(z.string().min(1).max(64)).max(12),
  entry: RollEntrySchema,
});
export type PrivateEntry = z.infer<typeof PrivateEntrySchema>;

/** Human-readable outcome, shared by the log, roll dialog, and GM panel. */
export const OUTCOME_LABELS: Record<z.infer<typeof ActionOutcomeSchema>, string> = {
  criticalSuccess: 'Critical Success',
  successHope: 'Success with Hope',
  successFear: 'Success with Fear',
  failureHope: 'Failure with Hope',
  failureFear: 'Failure with Fear',
  withHope: 'With Hope',
  withFear: 'With Fear',
};

/** Outcomes are colour-coded in the UI; this maps one to a stable class name. */
export function outcomeTone(
  outcome: z.infer<typeof ActionOutcomeSchema>,
): 'critical' | 'success' | 'failure' | 'hope' | 'fear' {
  if (outcome === 'criticalSuccess') return 'critical';
  // No Difficulty, so no verdict: the tone says only which die won.
  if (outcome === 'withHope') return 'hope';
  if (outcome === 'withFear') return 'fear';
  return outcome === 'successHope' || outcome === 'successFear' ? 'success' : 'failure';
}

/** A tray roll written out, `2d6+1d20+1`: the label a roll gets when nobody named it. */
export function formatDiceTray(
  dice: readonly { sides: number; count: number }[],
  modifier: number,
): string {
  const sets = dice.map(({ count, sides }) => `${count}d${sides}`).join('+');
  if (modifier === 0) return sets;
  return `${sets}${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}`;
}

/** Newest first, capped so a long session can't grow without bound. */
export const MAX_LOG_ENTRIES = 100;

export function appendRoll(log: readonly RollEntry[], entry: RollEntry): RollEntry[] {
  return [entry, ...log].slice(0, MAX_LOG_ENTRIES);
}
