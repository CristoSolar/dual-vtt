import { z } from 'zod';

/** The five outcomes of an action roll (SRD p.36). */
export const ActionOutcomeSchema = z.enum([
  'criticalSuccess',
  'successHope',
  'successFear',
  'failureHope',
  'failureFear',
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
    difficulty: z.number().int(),
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
};

/** Outcomes are colour-coded in the UI; this maps one to a stable class name. */
export function outcomeTone(
  outcome: z.infer<typeof ActionOutcomeSchema>,
): 'critical' | 'success' | 'failure' {
  if (outcome === 'criticalSuccess') return 'critical';
  return outcome === 'successHope' || outcome === 'successFear' ? 'success' : 'failure';
}

/** Newest first, capped so a long session can't grow without bound. */
export const MAX_LOG_ENTRIES = 100;

export function appendRoll(log: readonly RollEntry[], entry: RollEntry): RollEntry[] {
  return [entry, ...log].slice(0, MAX_LOG_ENTRIES);
}
