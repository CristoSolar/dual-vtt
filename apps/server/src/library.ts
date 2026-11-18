import type { LibraryCharacter, RoomPatch, SheetState } from '@daggerheart/protocol';

import type { CampaignStore } from './campaigns.js';
import type { CharacterRecord, CharacterStore } from './characters.js';

/**
 * Bookkeeping between an account's character library and the campaign rooms. No
 * game rules here: seating and releasing a sheet go through the room reducers in
 * `protocol` (via `CampaignStore`).
 *
 * The one invariant: a character linked to a campaign has exactly one live sheet,
 * the room's. Reads go through to the room; unlinking (or losing membership)
 * writes the room's sheet back. The library copy is never edited while linked.
 */

export interface Patches {
  patch: RoomPatch;
  playerPatch: RoomPatch;
}

export type LibraryResult =
  | { ok: true; record: CharacterRecord; outcome: Patches; campaignId: string | null }
  | { ok: false; status: number; error: string };

const refuse = (status: number, error: string): LibraryResult => ({ ok: false, status, error });

/** The sheet as it is right now: the room's while linked, the library's otherwise. */
export function liveSheet(record: CharacterRecord, campaigns: CampaignStore): SheetState {
  if (record.campaignId === null) return record.sheet;
  return campaigns.get(record.campaignId)?.state.characters[record.ownerId] ?? record.sheet;
}

export function toLibraryCharacter(record: CharacterRecord, campaigns: CampaignStore): LibraryCharacter {
  return {
    id: record.id,
    ownerId: record.ownerId,
    sheet: liveSheet(record, campaigns),
    campaignId: record.campaignId,
    campaignName: record.campaignId === null ? null : (campaigns.get(record.campaignId)?.name ?? null),
    updatedAt: record.updatedAt,
  };
}

export function listLibrary(
  characters: CharacterStore,
  campaigns: CampaignStore,
  ownerId: string,
): LibraryCharacter[] {
  // Creation order (the store's insertion order), so linking does not reshuffle the list.
  return characters.listFor(ownerId).map((record) => toLibraryCharacter(record, campaigns));
}

/** Every record with its live sheet, for the disk snapshot. */
export function serializeLibrary(characters: CharacterStore, campaigns: CampaignStore): CharacterRecord[] {
  return characters.serialize().map((record) => ({ ...record, sheet: liveSheet(record, campaigns) }));
}

export function linkCharacter(
  characters: CharacterStore,
  campaigns: CampaignStore,
  ownerId: string,
  characterId: string,
  campaignId: string,
): LibraryResult {
  const record = characters.get(characterId);
  if (record === null || record.ownerId !== ownerId) return refuse(404, 'unknownCharacter');
  if (record.campaignId !== null) return refuse(409, 'alreadyLinked');
  // A player slot only: the GM's seat has no character of its own.
  if (campaigns.roleOf(campaignId, ownerId) !== 'player') return refuse(403, 'forbidden');
  const room = campaigns.get(campaignId)?.state;
  if (characters.linkedIn(campaignId, ownerId) !== null || room?.characters[ownerId] !== undefined) {
    return refuse(409, 'campaignHasCharacter');
  }

  const outcome = campaigns.claimCharacter(campaignId, ownerId, record.sheet);
  if (!outcome.ok) return refuse(404, outcome.error ?? 'unknownCampaign');
  characters.update(record.id, { campaignId });
  return { ok: true, record, outcome, campaignId };
}

/** Writes the room's sheet back into the record and takes it out of the room. */
function release(characters: CharacterStore, campaigns: CampaignStore, record: CharacterRecord): Patches & { campaignId: string | null } {
  const campaignId = record.campaignId;
  if (campaignId === null) return { patch: {}, playerPatch: {}, campaignId };
  const released = campaigns.releaseCharacter(campaignId, record.ownerId);
  characters.update(record.id, {
    campaignId: null,
    ...(released.sheet === null ? {} : { sheet: released.sheet }),
  });
  return { patch: released.patch, playerPatch: released.playerPatch, campaignId };
}

export function unlinkCharacter(
  characters: CharacterStore,
  campaigns: CampaignStore,
  ownerId: string,
  characterId: string,
): LibraryResult {
  const record = characters.get(characterId);
  if (record === null || record.ownerId !== ownerId) return refuse(404, 'unknownCharacter');
  const { campaignId, ...outcome } = release(characters, campaigns, record);
  return { ok: true, record, outcome, campaignId };
}

/** Called before a member is removed, so the character they played comes home. */
export function detachMember(
  characters: CharacterStore,
  campaigns: CampaignStore,
  campaignId: string,
  accountId: string,
): Patches {
  const record = characters.linkedIn(campaignId, accountId);
  if (record === null) return { patch: {}, playerPatch: {} };
  const { patch, playerPatch } = release(characters, campaigns, record);
  return { patch, playerPatch };
}

/**
 * Sheets carry no id of their own, so "the same character" is the choices made at
 * creation that play never changes: name, class, subclass, heritage, community.
 */
function sameCharacter(a: SheetState, b: SheetState): boolean {
  const identity = (s: SheetState) =>
    JSON.stringify([
      s.character.name,
      s.character.classId,
      s.character.subclassId,
      s.character.heritage,
      s.character.communityId,
    ]);
  return identity(a) === identity(b);
}

/**
 * Brings the library and the rooms into agreement. Run at boot (it migrates rooms
 * from before the library existed) and after a socket claim. Idempotent.
 *
 * - A player's character in a room with no linked record gets one, linked there.
 * - A record linked to a room that no longer holds it (campaign gone, member
 *   removed while the library was not looking) is unlinked, keeping its last sheet.
 *
 * Returns how many records were adopted.
 */
export function adoptRoomCharacters(characters: CharacterStore, campaigns: CampaignStore): number {
  for (const record of characters.all()) {
    if (record.campaignId === null) continue;
    const room = campaigns.get(record.campaignId);
    if (room === null || room.state.characters[record.ownerId] === undefined) {
      characters.update(record.id, { campaignId: null });
    }
  }

  let adopted = 0;
  for (const campaign of campaigns.all()) {
    for (const [accountId, sheet] of Object.entries(campaign.state.characters)) {
      if (campaigns.roleOf(campaign.id, accountId) !== 'player') continue;
      if (characters.linkedIn(campaign.id, accountId) !== null) continue;
      // A crash between the campaigns and characters writes can leave the room
      // holding a character whose library entry still reads unlinked. Relink that
      // entry rather than filing a second copy of the same character.
      const twin = characters
        .listFor(accountId)
        .find((c) => c.campaignId === null && sameCharacter(c.sheet, sheet));
      if (twin !== undefined) {
        characters.update(twin.id, { campaignId: campaign.id });
        continue;
      }
      characters.create(accountId, sheet, campaign.id);
      adopted += 1;
    }
  }
  return adopted;
}
