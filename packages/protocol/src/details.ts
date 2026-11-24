import { z } from 'zod';

import { AvatarSchema } from './avatar.js';
import type { SheetState } from './sheet.js';

/**
 * Who a character is, as opposed to what they can do: the story fields a player
 * may rewrite at any time. Mechanics (traits, level, gear, cards) are not here —
 * play and level-up change those, through their own intents.
 *
 * Every field is optional and absent means "leave it". Unknown keys are refused,
 * so this cannot become a back door to the rest of the sheet.
 */
export const MAX_NAME_LENGTH = 60;
export const MAX_PRONOUNS_LENGTH = 40;
export const MAX_BACKGROUND_LENGTH = 4000;
export const MAX_CONNECTIONS = 12;
export const MAX_EXPERIENCE_NAME_LENGTH = 60;

export const CharacterDetailsSchema = z
  .object({
    /** Blank clears it, back to "unnamed". */
    name: z.string().max(MAX_NAME_LENGTH).nullable().optional(),
    /** Blank clears it. */
    pronouns: z.string().max(MAX_PRONOUNS_LENGTH).nullable().optional(),
    background: z.string().max(MAX_BACKGROUND_LENGTH).optional(),
    /** Replaces the whole list, the way the wizard's step 9 writes it. */
    connections: z
      .array(
        z
          .object({
            withCharacter: z.string().trim().min(1).max(80),
            description: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(MAX_CONNECTIONS)
      .optional(),
    /**
     * Renames Experiences, keeping each one's modifier. Only names change: an
     * Experience cannot be added, dropped or raised here (level-up does that).
     */
    experienceNames: z
      .array(
        z
          .object({
            from: z.string().min(1).max(MAX_EXPERIENCE_NAME_LENGTH),
            to: z.string().trim().min(1).max(MAX_EXPERIENCE_NAME_LENGTH),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    /** The portrait; null goes back to the ancestry's art. */
    avatar: AvatarSchema.nullable().optional(),
  })
  .strict();
export type CharacterDetails = z.infer<typeof CharacterDetailsSchema>;

export type EditDetailsResult =
  | { ok: true; sheet: SheetState }
  | { ok: false; error: 'unknownExperience' | 'rejected'; message: string };

const blankToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/** Applies a details edit to a sheet. Pure; the room and the library both run it. */
export function editSheetDetails(sheet: SheetState, details: CharacterDetails): EditDetailsResult {
  let experiences = sheet.character.experiences;
  if (details.experienceNames !== undefined && details.experienceNames.length > 0) {
    const renames = new Map<string, string>();
    for (const { from, to } of details.experienceNames) {
      if (!(from in sheet.character.experiences)) {
        return { ok: false, error: 'unknownExperience', message: `no Experience named ${from}` };
      }
      if (renames.has(from)) return { ok: false, error: 'rejected', message: `${from} renamed twice` };
      renames.set(from, to);
    }
    // All at once, in the sheet's own order, so two Experiences can swap names.
    const next: Record<string, number> = {};
    for (const [name, modifier] of Object.entries(sheet.character.experiences)) {
      const renamed = renames.get(name) ?? name;
      if (renamed in next) {
        return { ok: false, error: 'rejected', message: `two Experiences would be named ${renamed}` };
      }
      next[renamed] = modifier;
    }
    experiences = next;
  }

  const character = { ...sheet.character, experiences };
  if (details.name !== undefined) character.name = details.name === null ? null : blankToNull(details.name);
  if (details.pronouns !== undefined) {
    character.pronouns = details.pronouns === null ? null : blankToNull(details.pronouns);
  }
  if (details.background !== undefined) character.background = details.background.trim();
  if (details.connections !== undefined) {
    character.connections = details.connections.map((c) => ({
      withCharacter: c.withCharacter,
      description: c.description,
    }));
  }
  const avatar = details.avatar === undefined ? sheet.avatar : details.avatar;
  return { ok: true, sheet: { ...sheet, character, avatar } };
}
