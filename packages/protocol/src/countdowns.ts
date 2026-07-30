import type { ActionOutcome } from '@daggerheart/rules';
import { z } from 'zod';

/**
 * Countdowns represent a period of time or series of events preceding a future
 * effect. A countdown begins at a starting value, advancing reduces it by 1, and its
 * effect triggers when it reaches 0 (SRD p.68).
 */
export const CountdownKindSchema = z.enum([
  /** Advances every time a player makes an action roll. */
  'standard',
  /** Dynamic countdown to a positive effect. */
  'progress',
  /** Dynamic countdown to a negative effect. */
  'consequence',
  /** Advances after rests instead of action rolls. */
  'longTerm',
]);
export type CountdownKind = z.infer<typeof CountdownKindSchema>;

/** What happens when a countdown triggers (SRD p.69, "Advanced Countdown Features"). */
export const CountdownLoopSchema = z.enum([
  /** Triggers once and stops. */
  'none',
  /** Resets to its starting value after triggering. */
  'loop',
  /** Loops, increasing its starting value by 1 each time. */
  'increasing',
  /** Loops, decreasing its starting value by 1 each time. */
  'decreasing',
]);
export type CountdownLoop = z.infer<typeof CountdownLoopSchema>;

export const CountdownSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: CountdownKindSchema,
  /** Current value. The effect triggers at 0. */
  value: z.number().int().nonnegative(),
  startingValue: z.number().int().positive(),
  loop: CountdownLoopSchema,
  /** True once it has reached 0 and is not looping, so the UI can flag it. */
  triggered: z.boolean(),
});
export type Countdown = z.infer<typeof CountdownSchema>;

/**
 * The Dynamic Countdown Advancement chart (SRD p.69). Progress countdowns advance on
 * good outcomes and consequence countdowns on bad ones.
 */
const DYNAMIC_ADVANCEMENT: Record<ActionOutcome, { progress: number; consequence: number }> = {
  failureFear: { progress: 0, consequence: 3 },
  failureHope: { progress: 0, consequence: 2 },
  successFear: { progress: 1, consequence: 1 },
  successHope: { progress: 2, consequence: 0 },
  criticalSuccess: { progress: 3, consequence: 0 },
};

/**
 * How far a countdown advances for a given action roll outcome.
 *
 * Standard countdowns advance by 1 on any action roll; long-term countdowns advance
 * on rests instead, so an action roll never moves them (SRD p.68-69).
 */
export function advancementFor(kind: CountdownKind, outcome: ActionOutcome): number {
  switch (kind) {
    case 'standard':
      return 1;
    case 'progress':
      return DYNAMIC_ADVANCEMENT[outcome].progress;
    case 'consequence':
      return DYNAMIC_ADVANCEMENT[outcome].consequence;
    case 'longTerm':
      return 0;
  }
}

export interface CountdownTick {
  countdown: Countdown;
  /** True when this tick brought the countdown to 0. */
  triggered: boolean;
}

/**
 * Advances a countdown, reducing it by `amount`. On reaching 0 its effect triggers;
 * a looping countdown then resets, adjusting its starting value if it increases or
 * decreases (SRD p.69).
 */
export function advanceCountdown(countdown: Countdown, amount = 1): CountdownTick {
  if (amount <= 0) return { countdown, triggered: false };

  const value = Math.max(0, countdown.value - amount);
  if (value > 0) {
    return { countdown: { ...countdown, value }, triggered: false };
  }

  switch (countdown.loop) {
    case 'none':
      return { countdown: { ...countdown, value: 0, triggered: true }, triggered: true };
    case 'loop':
      return {
        countdown: { ...countdown, value: countdown.startingValue, triggered: false },
        triggered: true,
      };
    case 'increasing': {
      const startingValue = countdown.startingValue + 1;
      return {
        countdown: { ...countdown, startingValue, value: startingValue, triggered: false },
        triggered: true,
      };
    }
    case 'decreasing': {
      const startingValue = Math.max(1, countdown.startingValue - 1);
      return {
        countdown: { ...countdown, startingValue, value: startingValue, triggered: false },
        triggered: true,
      };
    }
  }
}

/**
 * Advances every countdown that responds to an action roll. Long-term countdowns are
 * untouched here; they advance on rests.
 */
export function advanceOnActionRoll(
  countdowns: readonly Countdown[],
  outcome: ActionOutcome,
): { countdowns: Countdown[]; triggeredIds: string[] } {
  const triggeredIds: string[] = [];
  const next = countdowns.map((countdown) => {
    if (countdown.triggered) return countdown;
    const amount = advancementFor(countdown.kind, outcome);
    const tick = advanceCountdown(countdown, amount);
    if (tick.triggered) triggeredIds.push(countdown.id);
    return tick.countdown;
  });
  return { countdowns: next, triggeredIds };
}

/** Advances long-term countdowns, which move on rests rather than action rolls. */
export function advanceOnRest(
  countdowns: readonly Countdown[],
  amount = 1,
): { countdowns: Countdown[]; triggeredIds: string[] } {
  const triggeredIds: string[] = [];
  const next = countdowns.map((countdown) => {
    if (countdown.kind !== 'longTerm' || countdown.triggered) return countdown;
    const tick = advanceCountdown(countdown, amount);
    if (tick.triggered) triggeredIds.push(countdown.id);
    return tick.countdown;
  });
  return { countdowns: next, triggeredIds };
}
