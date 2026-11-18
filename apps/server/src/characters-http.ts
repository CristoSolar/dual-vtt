import type { IncomingMessage, ServerResponse } from 'node:http';

import { CreateCharacterRequestSchema, LinkCharacterRequestSchema } from '@daggerheart/protocol';

import type { CampaignStore } from './campaigns.js';
import type { CharacterStore } from './characters.js';
import { actorFor } from './http-auth.js';
import { json, noContent, readJsonBody } from './http-json.js';
import {
  linkCharacter,
  listLibrary,
  toLibraryCharacter,
  unlinkCharacter,
  type LibraryResult,
  type Patches,
} from './library.js';
import type { SessionStore } from './sessions.js';
import type { UserStore } from './users.js';

export interface CharactersDeps {
  campaigns: CampaignStore;
  characters: CharacterStore;
  users: UserStore;
  sessions: SessionStore;
  /** Snapshots characters and campaigns: linking changes both. */
  persist: () => void;
  broadcast: (campaignId: string, outcome: Patches) => void;
}

/**
 * `/characters`: each account's own character library. Every route is owner-only
 * — someone else's character answers 404, the same as one that does not exist.
 */
export async function handleCharacters(
  request: IncomingMessage,
  response: ServerResponse,
  { campaigns, characters, users, sessions, persist, broadcast }: CharactersDeps,
): Promise<boolean> {
  const url = request.url ?? '';
  const method = request.method ?? 'GET';
  if (url !== '/characters' && !url.startsWith('/characters/')) return false;

  const actor = actorFor(request, sessions, users);
  if (actor === null) {
    json(response, 401, { error: 'unauthorized' });
    return true;
  }

  if (method === 'GET' && url === '/characters') {
    json(response, 200, listLibrary(characters, campaigns, actor.id));
    return true;
  }

  if (method === 'POST' && url === '/characters') {
    const parsed = CreateCharacterRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const record = characters.create(actor.id, parsed.data.sheet);
    persist();
    json(response, 201, toLibraryCharacter(record, campaigns));
    return true;
  }

  const answer = (result: LibraryResult): void => {
    if (!result.ok) {
      json(response, result.status, { error: result.error });
      return;
    }
    if (result.campaignId !== null) broadcast(result.campaignId, result.outcome);
    persist();
    json(response, 200, toLibraryCharacter(result.record, campaigns));
  };

  const linkMatch = /^\/characters\/([^/]+)\/link$/.exec(url);
  if (method === 'POST' && linkMatch !== null) {
    const parsed = LinkCharacterRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    answer(linkCharacter(characters, campaigns, actor.id, linkMatch[1] ?? '', parsed.data.campaignId));
    return true;
  }

  const unlinkMatch = /^\/characters\/([^/]+)\/unlink$/.exec(url);
  if (method === 'POST' && unlinkMatch !== null) {
    answer(unlinkCharacter(characters, campaigns, actor.id, unlinkMatch[1] ?? ''));
    return true;
  }

  const deleteMatch = /^\/characters\/([^/]+)$/.exec(url);
  if (method === 'DELETE' && deleteMatch !== null) {
    const record = characters.get(deleteMatch[1] ?? '');
    if (record === null || record.ownerId !== actor.id) {
      json(response, 404, { error: 'unknownCharacter' });
      return true;
    }
    // Unlink first: deleting a character still in play would orphan the room's copy.
    if (record.campaignId !== null) {
      json(response, 409, { error: 'linked' });
      return true;
    }
    characters.delete(record.id);
    persist();
    noContent(response);
    return true;
  }

  return false;
}
