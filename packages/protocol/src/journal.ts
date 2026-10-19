import { z } from 'zod';

import { SceneImageSchema } from './map.js';

/**
 * One page of the GM's journal: lore, a handout, an NPC. `shared` decides who gets
 * it — a `'gm'` entry never reaches a player's browser, and neither does any map
 * note pointing at one.
 */
export const JournalEntrySchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().min(1).max(80),
  body: z.string().max(20_000),
  image: SceneImageSchema.nullable(),
  shared: z.enum(['gm', 'all']),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

/** How many entries a campaign's journal holds. */
export const MAX_JOURNAL_ENTRIES = 100;
