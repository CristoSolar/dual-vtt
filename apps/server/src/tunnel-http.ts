import type { IncomingMessage, ServerResponse } from 'node:http';

import type { SessionStore } from './sessions.js';
import type { TunnelManager } from './tunnel.js';
import type { UserStore } from './users.js';

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

function isGm(request: IncomingMessage, sessions: SessionStore, users: UserStore): boolean {
  const token = bearerToken(request);
  if (token === null) return false;
  const userId = sessions.resolve(token);
  if (userId === null) return false;
  return users.findById(userId)?.role === 'gm';
}

export interface TunnelDeps {
  tunnel: TunnelManager;
  users: UserStore;
  sessions: SessionStore;
}

/**
 * Handles `/tunnel`. GM-only, both to open one (it costs a build the first time
 * and spends the process's one outbound tunnel) and to check on it — mirrors
 * `handleCampaigns`'s fallthrough contract.
 */
export async function handleTunnel(
  request: IncomingMessage,
  response: ServerResponse,
  { tunnel, users, sessions }: TunnelDeps,
): Promise<boolean> {
  const url = request.url ?? '';
  const method = request.method ?? 'GET';
  if (url !== '/tunnel') return false;

  if (!isGm(request, sessions, users)) {
    json(response, 401, { error: 'unauthorized' });
    return true;
  }

  if (method === 'GET') {
    json(response, 200, { url: tunnel.getUrl() });
    return true;
  }

  if (method === 'POST') {
    try {
      const link = await tunnel.ensure();
      json(response, 200, { url: link });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'the tunnel failed to start';
      json(response, 502, { error: 'tunnelFailed', message });
    }
    return true;
  }

  return false;
}
