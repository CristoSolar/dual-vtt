import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ManagedPlayer } from '@daggerheart/protocol';

import type { CampaignStore } from './campaigns.js';
import { actorFor } from './http-auth.js';
import { json } from './http-json.js';
import type { SessionStore } from './sessions.js';
import type { UserStore } from './users.js';

export interface PlayersDeps {
  campaigns: CampaignStore;
  users: UserStore;
  sessions: SessionStore;
}

/**
 * `GET /players`: the GM's "Mis jugadores". Each player this GM manages (see
 * `UserStore.managedBy`), with the GM's own campaigns they belong to or are invited
 * to — never another GM's — and when they last signed in. Creating a player and
 * resetting a password stay on `/users` (`auth-http.ts`).
 */
export async function handlePlayers(
  request: IncomingMessage,
  response: ServerResponse,
  { campaigns, users, sessions }: PlayersDeps,
): Promise<boolean> {
  if (request.url !== '/players') return false;
  if ((request.method ?? 'GET') !== 'GET') return false;

  const actor = actorFor(request, sessions, users);
  if (actor === null) {
    json(response, 401, { error: 'unauthorized' });
    return true;
  }
  if (actor.role !== 'gm') {
    json(response, 403, { error: 'forbidden' });
    return true;
  }

  const mine = campaigns.all().filter((c) => c.ownerId === actor.id);
  const rows: ManagedPlayer[] = users.managedBy(actor.id).map((player) => ({
    id: player.id,
    username: player.username,
    mustChangePassword: player.mustChangePassword,
    campaigns: mine
      .filter((c) => c.memberIds.includes(player.id))
      .map((c) => ({ id: c.id, name: c.name, status: c.status })),
    invitedTo: mine.filter((c) => c.invitedIds.includes(player.id)).map((c) => ({ id: c.id, name: c.name })),
    lastLoginAt: player.lastLoginAt,
  }));
  json(response, 200, rows);
  return true;
}
