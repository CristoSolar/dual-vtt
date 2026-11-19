import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  CampaignPrepEventSchema,
  CreateCampaignRequestSchema,
  InvitePlayerRequestSchema,
  UpdateCampaignRequestSchema,
  type CampaignDetail,
  type CampaignList,
  type CampaignSummary,
  type User,
} from '@daggerheart/protocol';

import { patchesFor, type CampaignRecord, type CampaignStore } from './campaigns.js';
import type { CharacterStore } from './characters.js';
import { actorFor } from './http-auth.js';
import { json, noContent, readJsonBody } from './http-json.js';
import { detachMember, type Patches } from './library.js';
import type { SessionStore } from './sessions.js';
import type { UserStore } from './users.js';

/**
 * Only the owner learns who is invited. Someone who is merely invited is not told
 * who the members are either — that is for the table to see once they join.
 */
function toSummary(campaign: CampaignRecord, ownerUsername: string, viewerId: string): CampaignSummary {
  const isOwner = campaign.ownerId === viewerId;
  const isMember = isOwner || campaign.memberIds.includes(viewerId);
  return {
    id: campaign.id,
    name: campaign.name,
    ownerId: campaign.ownerId,
    ownerUsername,
    memberIds: isMember ? campaign.memberIds : [],
    invitedIds: isOwner ? campaign.invitedIds : [],
    status: campaign.status,
  };
}

/**
 * The GM's campaign page: members with the character each plays here, invitees by
 * name, and the three GM slices the page edits. Not a room — nothing else of the
 * state is sent, and none of this goes to anyone but the owner.
 */
function toDetail(campaign: CampaignRecord, summary: CampaignSummary, users: UserStore): CampaignDetail {
  const usernameOf = (id: string): string => users.findById(id)?.username ?? id;
  return {
    campaign: summary,
    members: campaign.memberIds.map((id) => {
      const sheet = campaign.state.characters[id];
      return {
        id,
        username: usernameOf(id),
        character:
          sheet === undefined
            ? null
            : { name: sheet.character.name, classId: sheet.character.classId, level: sheet.character.level },
      };
    }),
    invited: campaign.invitedIds.map((id) => ({ id, username: usernameOf(id) })),
    story: campaign.state.story,
    prepAdversaries: campaign.state.prepAdversaries,
    journal: campaign.state.journal,
  };
}

export interface CampaignsDeps {
  campaigns: CampaignStore;
  /** A removed member's linked character is written back into their library. */
  characters: CharacterStore;
  users: UserStore;
  sessions: SessionStore;
  /** Called after any mutation, so the caller can snapshot to disk right away. */
  persist: () => void;
  /** Sends a room change to the campaign's live sockets. */
  broadcast: (campaignId: string, outcome: Patches) => void;
  /** Cuts the campaign's seated players off, when it stops being active. */
  unseatPlayers: (campaignId: string) => void;
}

/**
 * Handles `/campaigns` and its sub-routes. Mirrors `handleAuth`/`handleUploads`:
 * returns true when it handled the request, so the caller can fall through.
 */
export async function handleCampaigns(
  request: IncomingMessage,
  response: ServerResponse,
  { campaigns, characters, users, sessions, persist, broadcast, unseatPlayers }: CampaignsDeps,
): Promise<boolean> {
  const url = request.url ?? '';
  const method = request.method ?? 'GET';

  const isCampaignsRoute = url === '/campaigns' || url.startsWith('/campaigns/');
  if (!isCampaignsRoute) return false;

  const actor: User | null = actorFor(request, sessions, users);
  if (actor === null) {
    json(response, 401, { error: 'unauthorized' });
    return true;
  }
  const summaryFor = (c: CampaignRecord): CampaignSummary =>
    toSummary(c, users.findById(c.ownerId)?.username ?? c.state.gm.name, actor.id);

  if (method === 'POST' && url === '/campaigns') {
    const parsed = CreateCampaignRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const created = campaigns.createCampaign(actor.id, actor.username, parsed.data.name);
    persist();
    json(response, 201, summaryFor(created));
    return true;
  }

  if (method === 'GET' && url === '/campaigns') {
    const list: CampaignList = {
      member: campaigns.listFor(actor.id).map(summaryFor),
      invited: campaigns.listInvitedFor(actor.id).map(summaryFor),
    };
    json(response, 200, list);
    return true;
  }

  // --- the GM's campaign page ------------------------------------------------
  const campaignMatch = /^\/campaigns\/([^/]+)$/.exec(url);
  const prepMatch = /^\/campaigns\/([^/]+)\/prep$/.exec(url);
  const ownedCampaign = (campaignId: string): CampaignRecord | null =>
    campaigns.roleOf(campaignId, actor.id) === 'gm' ? campaigns.get(campaignId) : null;

  if (method === 'GET' && campaignMatch !== null) {
    const campaign = ownedCampaign(campaignMatch[1] ?? '');
    if (campaign === null) {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    json(response, 200, toDetail(campaign, summaryFor(campaign), users));
    return true;
  }

  if (method === 'PATCH' && campaignMatch !== null) {
    const campaign = ownedCampaign(campaignMatch[1] ?? '');
    if (campaign === null) {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    const parsed = UpdateCampaignRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    if (parsed.data.name !== undefined) campaigns.rename(campaign.id, actor.id, parsed.data.name);
    if (parsed.data.status !== undefined) {
      campaigns.setStatus(campaign.id, actor.id, parsed.data.status);
      // Paused or finished: the players at the table leave it now, not at their
      // next message. Their seats' connected flags change, so the GM hears it.
      if (parsed.data.status !== 'active') unseatPlayers(campaign.id);
    }
    persist();
    json(response, 200, summaryFor(campaign));
    return true;
  }

  if (method === 'POST' && prepMatch !== null) {
    const campaign = ownedCampaign(prepMatch[1] ?? '');
    if (campaign === null) {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    const parsed = CampaignPrepEventSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    // The same choke point as a socket intent, with the actor from the token.
    const outcome = campaigns.apply(campaign.id, { id: actor.id, role: 'gm' }, parsed.data);
    if (!outcome.ok) {
      json(response, 409, { error: outcome.error ?? 'rejected' });
      return true;
    }
    broadcast(campaign.id, outcome);
    persist();
    json(response, 200, toDetail(campaign, summaryFor(campaign), users));
    return true;
  }

  const inviteMatch = /^\/campaigns\/([^/]+)\/invites$/.exec(url);
  if (method === 'POST' && inviteMatch !== null) {
    const parsed = InvitePlayerRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const campaignId = inviteMatch[1] ?? '';
    // Ownership before the username lookup, so a non-owner cannot probe for names.
    if (campaigns.roleOf(campaignId, actor.id) !== 'gm') {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    const target = users.findByUsername(parsed.data.username);
    // A player another GM manages answers exactly like a missing one.
    if (target === null || !users.isManagedBy(target.id, actor.id)) {
      json(response, 404, { error: 'unknownUsername' });
      return true;
    }
    const result = campaigns.invite(campaignId, actor.id, target.id);
    if (result !== 'ok') {
      json(response, result === 'forbidden' ? 403 : 409, { error: result });
      return true;
    }
    persist();
    noContent(response);
    return true;
  }

  const answerMatch = /^\/campaigns\/([^/]+)\/invites\/(accept|decline)$/.exec(url);
  if (method === 'POST' && answerMatch !== null) {
    const campaignId = answerMatch[1] ?? '';
    const ok =
      answerMatch[2] === 'accept'
        ? campaigns.acceptInvite(campaignId, actor.id)
        : campaigns.declineInvite(campaignId, actor.id);
    if (!ok) {
      json(response, 404, { error: 'noInvitation' });
      return true;
    }
    persist();
    noContent(response);
    return true;
  }

  const cancelMatch = /^\/campaigns\/([^/]+)\/invites\/([^/]+)$/.exec(url);
  if (method === 'DELETE' && cancelMatch !== null) {
    const campaignId = cancelMatch[1] ?? '';
    if (campaigns.roleOf(campaignId, actor.id) !== 'gm') {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    campaigns.cancelInvite(campaignId, actor.id, cancelMatch[2] ?? '');
    persist();
    noContent(response);
    return true;
  }

  const removePlayerMatch = /^\/campaigns\/([^/]+)\/players\/([^/]+)$/.exec(url);
  if (method === 'DELETE' && removePlayerMatch !== null) {
    const campaignId = removePlayerMatch[1] ?? '';
    if (campaigns.roleOf(campaignId, actor.id) !== 'gm') {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    const memberId = removePlayerMatch[2] ?? '';
    // The character they played goes home to their library with its current sheet
    // before the room forgets them. One diff over both steps, so the table hears
    // once that the seat and the character are gone.
    const before = campaigns.get(campaignId)?.state;
    detachMember(characters, campaigns, campaignId, memberId);
    campaigns.removeMember(campaignId, actor.id, memberId);
    const after = campaigns.get(campaignId)?.state;
    if (before !== undefined && after !== undefined) broadcast(campaignId, patchesFor(before, after));
    persist();
    noContent(response);
    return true;
  }

  return false;
}
