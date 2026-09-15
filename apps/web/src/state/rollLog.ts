/**
 * The roll log shape is part of the wire protocol, so it lives in
 * `@daggerheart/protocol`. Re-exported here to keep existing imports working.
 */
export {
  appendRoll,
  MAX_LOG_ENTRIES,
  outcomeTone,
  type RollEntry,
} from '@daggerheart/protocol';

import { formatDice, type Dice } from '@daggerheart/srd-data';

export { describeRollEntry } from '../i18n/index.js';

/** Renders a damage expression for display, e.g. "2d8+3". */
export function describeDamage(dice: Dice): string {
  return formatDice(dice);
}
