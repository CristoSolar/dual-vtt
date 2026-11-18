import { z } from 'zod';

import { SheetStateSchema } from './sheet.js';

/**
 * A character in its owner's library on the server. It can be linked to at most
 * one campaign at a time; while it is, the room's copy is the live one and this
 * entry is read through from it, so there are never two diverging sheets.
 */
export const LibraryCharacterSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  sheet: SheetStateSchema,
  /** The campaign it is linked to, or null when it sits in the library only. */
  campaignId: z.string().min(1).nullable(),
  /** That campaign's name, for display; null when unlinked or the campaign is gone. */
  campaignName: z.string().nullable(),
  updatedAt: z.number(),
});
export type LibraryCharacter = z.infer<typeof LibraryCharacterSchema>;

export const LibraryListSchema = z.array(LibraryCharacterSchema);

/** `POST /characters`: a finished character from the creation wizard (or an import). */
export const CreateCharacterRequestSchema = z.object({
  sheet: SheetStateSchema,
});
export type CreateCharacterRequest = z.infer<typeof CreateCharacterRequestSchema>;

/** `POST /characters/:id/link`. */
export const LinkCharacterRequestSchema = z.object({
  campaignId: z.string().min(1),
});
export type LinkCharacterRequest = z.infer<typeof LinkCharacterRequestSchema>;
