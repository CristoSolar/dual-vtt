import {
  CampaignDetailSchema,
  ManagedPlayerSchema,
  MAX_PREP_QUANTITY,
  type AdversaryInstance,
  type CampaignDetail,
  type CampaignStatus,
  type CampaignSummary,
  type ManagedPlayer,
  type RoomEvent,
} from '@daggerheart/protocol';
import type { Adversary } from '@daggerheart/srd-data';

/**
 * The GM's home, as pure functions over what the server sends: campaigns grouped
 * by status, the campaign page's detail, "Mis jugadores", and the prep list's
 * search and hand-off to the encounter. Every response is parsed here.
 */

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['active', 'paused', 'finished'];

/** The campaigns this account runs, by status. Ones it only plays in are left out. */
export function campaignsByStatus(
  campaigns: readonly CampaignSummary[],
  accountId: string,
): Record<CampaignStatus, CampaignSummary[]> {
  const groups: Record<CampaignStatus, CampaignSummary[]> = { active: [], paused: [], finished: [] };
  for (const campaign of campaigns) {
    if (campaign.ownerId === accountId) groups[campaign.status].push(campaign);
  }
  return groups;
}

/** A player sits only at an active campaign; its GM may open any of theirs. The server enforces the same. */
export function canEnter(campaign: CampaignSummary, accountId: string): boolean {
  return campaign.ownerId === accountId || campaign.status === 'active';
}

export function parseCampaignDetail(body: unknown): CampaignDetail | null {
  const parsed = CampaignDetailSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Readable rows only — one bad row must not hide the rest. */
export function parseManagedPlayers(body: unknown): ManagedPlayer[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((item) => {
    const parsed = ManagedPlayerSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Players who could still be invited: neither members nor already invited. */
export function invitablePlayers(
  players: readonly ManagedPlayer[],
  campaign: Pick<CampaignSummary, 'memberIds' | 'invitedIds'>,
): ManagedPlayer[] {
  return players.filter((p) => !campaign.memberIds.includes(p.id) && !campaign.invitedIds.includes(p.id));
}

/** This GM's campaigns a "Mis jugadores" row could still be invited to. */
export function invitableCampaigns(
  player: ManagedPlayer,
  campaigns: readonly CampaignSummary[],
  accountId: string,
): CampaignSummary[] {
  const taken = new Set([...player.campaigns, ...player.invitedTo].map((c) => c.id));
  return campaigns.filter((c) => c.ownerId === accountId && !taken.has(c.id));
}

export interface AdversaryFilter {
  query: string;
  tier: number | null;
  type: Adversary['type'] | null;
}

export function filterAdversaries(adversaries: readonly Adversary[], filter: AdversaryFilter): Adversary[] {
  const needle = filter.query.trim().toLowerCase();
  return adversaries.filter(
    (a) =>
      (needle === '' || a.name.toLowerCase().includes(needle)) &&
      (filter.tier === null || a.tier === filter.tier) &&
      (filter.type === null || a.type === filter.type),
  );
}

/**
 * The `addAdversary` intents that field `count` of an adversary, lettered when
 * there is more than one: a fight with four guards needs four names the table can
 * say out loud. Letters continue after the ones of that kind already in play.
 */
export function encounterEvents(
  inPlay: readonly AdversaryInstance[],
  adversaryId: string,
  baseName: string,
  count: number,
  nextId: () => string,
): Extract<RoomEvent, { type: 'addAdversary' }>[] {
  const existing = inPlay.filter((i) => i.adversaryId === adversaryId).length;
  return Array.from({ length: count }, (_, i) => {
    const index = existing + i;
    const letter = String.fromCharCode(65 + (index % 26));
    return {
      type: 'addAdversary',
      instanceId: nextId(),
      adversaryId,
      name: count === 1 && existing === 0 ? baseName : `${baseName} ${letter}`,
    };
  });
}

/**
 * What a prep quantity field holds once the GM is done typing: a whole number
 * clamped to 1..20, or null — nothing to commit — for an empty or unreadable
 * draft, which then snaps back to the saved value.
 */
export function parseQuantityDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return Math.max(1, Math.min(MAX_PREP_QUANTITY, Number(trimmed)));
}

/**
 * Tickets for requests whose responses replace the same state: only the newest
 * ticket's response may land, so a slow older one never writes stale data over a
 * newer one.
 */
export function createLatestGate(): { begin: () => number; isLatest: (ticket: number) => boolean } {
  let latest = 0;
  return {
    begin: () => {
      latest += 1;
      return latest;
    },
    isLatest: (ticket) => ticket === latest,
  };
}
