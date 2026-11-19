import type { CampaignStore } from './campaigns.js';
import type { StoredUser, UserStore } from './users.js';

/**
 * Which GM may see, invite and reset a player account. A player created over HTTP
 * belongs to the GM who created it (`createdBy`). A legacy one (`createdBy: null`,
 * made before that was recorded) belongs to every GM whose table it sits at —
 * member or invitee of one of their campaigns — and to nobody else, so one GM can
 * never reset another GM's player and take the account over. The exception is a
 * legacy player at no table at all on a server with a single GM: there is no one
 * else it could belong to, and hiding it would strand it.
 */

/** The GMs whose campaigns this account is a member of or invited to. */
function tablesOf(campaigns: CampaignStore, userId: string): Set<string> {
  return new Set(
    campaigns
      .all()
      .filter((c) => c.memberIds.includes(userId) || c.invitedIds.includes(userId))
      .map((c) => c.ownerId),
  );
}

export function managesPlayer(users: UserStore, campaigns: CampaignStore, gmId: string, userId: string): boolean {
  const user = users.findStored(userId);
  if (user === null || user.role !== 'player') return false;
  if (user.createdBy !== null) return user.createdBy === gmId;
  const tables = tablesOf(campaigns, userId);
  if (tables.has(gmId)) return true;
  return tables.size === 0 && users.list('gm').length === 1;
}

export function playersManagedBy(users: UserStore, campaigns: CampaignStore, gmId: string): StoredUser[] {
  return users.players().filter((user) => managesPlayer(users, campaigns, gmId, user.id));
}

/**
 * The first time a GM resets or invites a legacy player it manages, it becomes
 * that GM's — unless the player also sits at another GM's table, where claiming it
 * would cut that GM off. Returns whether anything changed, so the caller persists.
 */
export function claimLegacyPlayer(users: UserStore, campaigns: CampaignStore, gmId: string, userId: string): boolean {
  const user = users.findStored(userId);
  if (user === null || user.createdBy !== null || !managesPlayer(users, campaigns, gmId, userId)) return false;
  if ([...tablesOf(campaigns, userId)].some((owner) => owner !== gmId)) return false;
  return users.claim(userId, gmId);
}
