import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  AddPlayerRequestSchema,
  CreateCampaignRequestSchema,
  type CampaignSummary,
  type User,
} from '@daggerheart/protocol';

import type { CampaignRecord, CampaignStore } from './campaigns.js';
import type { SessionStore } from './sessions.js';
import { readBody } from './uploads.js';
import type { UserStore } from './users.js';

const MAX_CAMPAIGNS_BODY_BYTES = 64 * 1024;

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const noContent = (response: ServerResponse): void => {
  response.writeHead(204);
  response.end();
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const bytes = await readBody(request, MAX_CAMPAIGNS_BODY_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

function actorFor(request: IncomingMessage, sessions: SessionStore, users: UserStore): User | null {
  const token = bearerToken(request);
  if (token === null) return null;
  const userId = sessions.resolve(token);
  if (userId === null) return null;
  return users.findById(userId);
}

function toSummary(campaign: CampaignRecord, ownerUsername: string): CampaignSummary {
  return {
    id: campaign.id,
    name: campaign.name,
    ownerId: campaign.ownerId,
    ownerUsername,
    memberIds: campaign.memberIds,
  };
}

export interface CampaignsDeps {
  campaigns: CampaignStore;
  users: UserStore;
  sessions: SessionStore;
  /** Called after any mutation, so the caller can snapshot to disk right away. */
  persist: () => void;
}

/**
 * Handles `/campaigns` and its sub-routes. Mirrors `handleAuth`/`handleUploads`:
 * returns true when it handled the request, so the caller can fall through.
 */
export async function handleCampaigns(
  request: IncomingMessage,
  response: ServerResponse,
  { campaigns, users, sessions, persist }: CampaignsDeps,
): Promise<boolean> {
  const url = request.url ?? '';
  const method = request.method ?? 'GET';

  if (method === 'POST' && url === '/campaigns') {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const parsed = CreateCampaignRequestSchema.safeParse(await readJsonBody(request).catch(() => null));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const created = campaigns.createCampaign(actor.id, actor.username, parsed.data.name);
    persist();
    json(response, 201, toSummary(created, actor.username));
    return true;
  }

  if (method === 'GET' && url === '/campaigns') {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const list = campaigns.listFor(actor.id).map((c) => {
      const owner = users.findById(c.ownerId);
      return toSummary(c, owner?.username ?? c.state.gm.name);
    });
    json(response, 200, list);
    return true;
  }

  const addPlayerMatch = /^\/campaigns\/([^/]+)\/players$/.exec(url);
  if (method === 'POST' && addPlayerMatch !== null) {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const parsed = AddPlayerRequestSchema.safeParse(await readJsonBody(request).catch(() => null));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const target = users.findByUsername(parsed.data.username);
    if (target === null) {
      json(response, 404, { error: 'unknownUsername' });
      return true;
    }
    const campaignId = addPlayerMatch[1] ?? '';
    const ok = campaigns.addMember(campaignId, actor.id, target.id);
    if (!ok) {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    persist();
    noContent(response);
    return true;
  }

  const removePlayerMatch = /^\/campaigns\/([^/]+)\/players\/([^/]+)$/.exec(url);
  if (method === 'DELETE' && removePlayerMatch !== null) {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const campaignId = removePlayerMatch[1] ?? '';
    const memberId = removePlayerMatch[2] ?? '';
    const ok = campaigns.removeMember(campaignId, actor.id, memberId);
    if (!ok) {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    persist();
    noContent(response);
    return true;
  }

  return false;
}
