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
    kind: z.literal('damage'),
    id: z.string().min(1),
    at: z.number(),
    by: z.string().min(1),
    label: z.string().min(1),
    roll: DamageRollSchema,
    critical: z.boolean(),
  }),
]);
export type RollEntry = z.infer<typeof RollEntrySchema>;

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
