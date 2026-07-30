/**
 * The roll log shape is part of the wire protocol, so it lives in
 * `@daggerheart/protocol`. Re-exported here to keep existing imports working.
 */
export {
  appendRoll,
  MAX_LOG_ENTRIES,
  OUTCOME_LABELS,
  outcomeTone,
  type RollEntry,
} from '@daggerheart/protocol';

import { formatDice, type Dice } from '@daggerheart/srd-data';

/** Renders a damage expression for display, e.g. "2d8+3". */
export function describeDamage(dice: Dice): string {
  return formatDice(dice);
}
