import type { JournalEntry } from '@daggerheart/protocol';

/**
 * The shared entries this client has not been shown yet, oldest first. A player's
 * journal only ever holds shared entries, so a new id there is one the GM has just
 * put in front of the table; `seen` lives in memory, so a reload starts over.
 */
export function newlyShared(
  journal: readonly JournalEntry[],
  seen: ReadonlySet<string>,
): JournalEntry[] {
  return journal.filter((entry) => entry.shared === 'all' && !seen.has(entry.id));
}
