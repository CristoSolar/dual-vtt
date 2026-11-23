import { deserialize, finalize, STEPS, validateStep, type CreationState } from '@daggerheart/character';
import {
  CampaignListSchema,
  createSheet,
  LibraryCharacterSchema,
  SheetStateSchema,
  type CampaignList,
  type CampaignSummary,
  type LibraryCharacter,
  type SheetState,
} from '@daggerheart/protocol';
import { z } from 'zod';

import type { StorageLike } from './storage.js';
import { artUrl } from './art.js';

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

/** The ancestry art the wizard already shows, as a portrait for the list. */
export function characterPortrait(sheet: SheetState): string {
  const { heritage } = sheet.character;
  const ancestryId = heritage.kind === 'single' ? heritage.ancestryId : heritage.first.ancestryId;
  return artUrl('ancestries', ancestryId);
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
