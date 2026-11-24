import { deserialize, finalize, STEPS, validateStep, type CreationState } from '@daggerheart/character';
import {
  CampaignListSchema,
  createSheet,
  LibraryCharacterSchema,
  SheetStateSchema,
  type CampaignList,
  type Avatar,
  type CampaignSummary,
  type EditCharacterRequest,
  type LibraryCharacter,
  type SheetState,
} from '@daggerheart/protocol';
import { z } from 'zod';

import type { StorageLike } from './storage.js';
import { avatarImage } from './avatar.js';

/**
 * The player's character library, as pure functions over what the server sends.
 * Every response is parsed here: the network is a trust boundary like storage.
 */

/** The wizard's draft slot. Drafts stay in this browser; finished characters do not. */
export const DRAFT_SCOPE = 'library';

/** Readable entries only — one bad entry must not hide the rest of the library. */
export function parseLibrary(body: unknown): LibraryCharacter[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((item) => {
    const parsed = LibraryCharacterSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function parseCampaignList(body: unknown): CampaignList {
  const parsed = CampaignListSchema.safeParse(body);
  return parsed.success ? parsed.data : { member: [], invited: [] };
}

/** My character linked to this campaign, if any. */
export function characterIn(
  characters: readonly LibraryCharacter[],
  campaignId: string,
): LibraryCharacter | null {
  return characters.find((c) => c.campaignId === campaignId) ?? null;
}

/**
 * Where a character could be linked: campaigns I play in (not ones I run) that do
 * not already have a character of mine — the server enforces the same.
 */
export function linkableCampaigns(
  characters: readonly LibraryCharacter[],
  campaigns: readonly CampaignSummary[],
  accountId: string,
): CampaignSummary[] {
  return campaigns.filter((c) => c.ownerId !== accountId && characterIn(characters, c.id) === null);
}

/** The picture a character is drawn with — its avatar, or its ancestry's art. */
export function characterPortrait(sheet: SheetState): string {
  return avatarImage(sheet).src;
}

/**
 * Where "Ver hoja" leads: into the campaign, where the room's sheet is live and
 * playable, when the character is linked to one this account may enter now;
 * otherwise the read-only library view.
 */
export function playableCampaign(
  entry: LibraryCharacter,
  campaigns: readonly CampaignSummary[],
): CampaignSummary | null {
  if (entry.campaignId === null) return null;
  const campaign = campaigns.find((c) => c.id === entry.campaignId);
  return campaign !== undefined && campaign.status === 'active' ? campaign : null;
}

// --- editing who a character is ------------------------------------------------

/** The edit form's fields, as text boxes hold them. */
export interface DetailsDraft {
  name: string;
  pronouns: string;
  background: string;
  /** One per Experience, in the sheet's order. */
  experiences: string[];
  connections: { withCharacter: string; description: string }[];
  /** Null is the ancestry's art. */
  avatar: Avatar | null;
}

export type DetailsProblem = 'emptyExperience' | 'duplicateExperience' | 'halfConnection';

export function draftFromSheet(sheet: SheetState): DetailsDraft {
  const c = sheet.character;
  return {
    name: c.name ?? '',
    pronouns: c.pronouns ?? '',
    background: c.background,
    experiences: Object.keys(c.experiences),
    connections: c.connections.map((x) => ({ ...x })),
    avatar: sheet.avatar,
  };
}

/**
 * Turns the form into a `PATCH /characters/:id` body, or says what is wrong with
 * it. Blank connection rows are dropped; a half-filled one is a mistake to fix.
 */
export function detailsRequest(
  sheet: SheetState,
  draft: DetailsDraft,
): { ok: true; request: EditCharacterRequest } | { ok: false; problem: DetailsProblem } {
  const names = draft.experiences.map((n) => n.trim());
  if (names.some((n) => n === '')) return { ok: false, problem: 'emptyExperience' };
  if (new Set(names).size !== names.length) return { ok: false, problem: 'duplicateExperience' };

  const connections: { withCharacter: string; description: string }[] = [];
  for (const row of draft.connections) {
    const withCharacter = row.withCharacter.trim();
    const description = row.description.trim();
    if (withCharacter === '' && description === '') continue;
    if (withCharacter === '' || description === '') return { ok: false, problem: 'halfConnection' };
    connections.push({ withCharacter, description });
  }

  const experienceNames = Object.keys(sheet.character.experiences).flatMap((from, i) => {
    const to = names[i];
    return to === undefined || to === from ? [] : [{ from, to }];
  });

  return {
    ok: true,
    request: {
      name: draft.name.trim() === '' ? null : draft.name.trim(),
      pronouns: draft.pronouns.trim() === '' ? null : draft.pronouns.trim(),
      background: draft.background.trim(),
      connections,
      experienceNames,
      // Only sent when changed, so an edit of the other fields leaves it alone.
      ...(JSON.stringify(draft.avatar) === JSON.stringify(sheet.avatar) ? {} : { avatar: draft.avatar }),
    },
  };
}

// --- characters left in this browser by the old flow -------------------------

const PREFIX = 'daggerheart-vtt';
const OLD_LIBRARY_KEY = `${PREFIX}:characters`;
const DRAFT_PREFIX = `${PREFIX}:creation`;
const IMPORTED_PREFIX = `${PREFIX}:imported:`;

const OldLibrarySchema = z.array(z.object({ sheet: z.unknown() }).passthrough());

export interface LegacyFinds {
  /** Finished characters, ready to send to the library. */
  importable: Array<{ key: string; sheet: SheetState; importId: string }>;
  /** Unfinished wizard drafts, which can be resumed in the wizard. */
  drafts: Array<{ key: string; state: CreationState }>;
  /** Entries that no longer parse; left where they are, never deleted. */
  unreadable: number;
}

const isOldDraftKey = (key: string): boolean =>
  (key === DRAFT_PREFIX || key.startsWith(`${DRAFT_PREFIX}:`)) &&
  key !== `${DRAFT_PREFIX}:${DRAFT_SCOPE}` &&
  !key.endsWith(':unreadable');

/** A short, stable fingerprint, so the same local entry always imports under one id. */
function fingerprint(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = (Math.imul(hash, 33) ^ text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

const isComplete = (state: CreationState): boolean => STEPS.every((step) => validateStep(state, step).ok);

/**
 * Before the library lived on the server, a browser kept its finished characters
 * under `daggerheart-vtt:characters` and a wizard draft per campaign under
 * `daggerheart-vtt:creation[:campaignId]`. This finds whatever is left of both.
 * `keys` is every key in the storage (`Object.keys(localStorage)`).
 */
export function findLegacyCharacters(storage: StorageLike, keys: readonly string[]): LegacyFinds {
  const found: LegacyFinds = { importable: [], drafts: [], unreadable: 0 };

  for (const key of [...keys].sort()) {
    const raw = storage.getItem(key);
    if (raw === null) continue;

    if (key === OLD_LIBRARY_KEY) {
      let entries: unknown;
      try {
        entries = JSON.parse(raw);
      } catch {
        found.unreadable += 1;
        continue;
      }
      const list = OldLibrarySchema.safeParse(entries);
      if (!list.success) {
        found.unreadable += 1;
        continue;
      }
      list.data.forEach((item, index) => {
        const sheet = SheetStateSchema.safeParse(item.sheet);
        if (!sheet.success) {
          found.unreadable += 1;
          return;
        }
        const localId = typeof item.id === 'string' ? item.id : `#${index}`;
        found.importable.push({
          key,
          sheet: sheet.data,
          importId: `legacy:${key}:${localId}:${fingerprint(JSON.stringify(item.sheet))}`,
        });
      });
      continue;
    }

    if (isOldDraftKey(key)) {
      let state: CreationState;
      try {
        state = deserialize(raw);
      } catch {
        found.unreadable += 1;
        continue;
      }
      if (isComplete(state)) {
        found.importable.push({
          key,
          sheet: createSheet(finalize(state), { transformation: state.transformation }),
          importId: `legacy:${key}:${fingerprint(raw)}`,
        });
      }
      else found.drafts.push({ key, state });
    }
  }
  return found;
}

/** Moves imported keys aside under `daggerheart-vtt:imported:` — kept, not deleted. */
export function markLegacyImported(storage: StorageLike, keys: readonly string[]): void {
  for (const key of new Set(keys)) {
    const raw = storage.getItem(key);
    if (raw === null) continue;
    try {
      storage.setItem(`${IMPORTED_PREFIX}${key}`, raw);
      storage.removeItem(key);
    } catch {
      // Out of quota: leave the original in place; offering it again is harmless.
    }
  }
}
