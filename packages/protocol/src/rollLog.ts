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
