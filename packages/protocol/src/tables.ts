import { z } from 'zod';

/**
 * A GM random table: a name and the rows it can land on. Rolling it picks one row
 * uniformly at random — there is no weighting, same as a loot table on a card.
 */
export const RollTableSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  rows: z.array(z.string().min(1).max(200)).min(1).max(100),
});
export type RollTable = z.infer<typeof RollTableSchema>;

/** How many tables a campaign can hold. */
export const MAX_TABLES = 30;
