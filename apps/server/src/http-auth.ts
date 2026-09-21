import type { IncomingMessage } from 'node:http';

import type { User } from '@daggerheart/protocol';

import type { SessionStore } from './sessions.js';
import type { UserStore } from './users.js';

/**
 * Who is calling an HTTP route. Every route that mutates anything resolves the
 * account this way — from the bearer token, never from a field in the body.
 */

export function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

export function actorFor(
  request: IncomingMessage,
  sessions: SessionStore,
  users: UserStore,
): User | null {
  const token = bearerToken(request);
  if (token === null) return null;
  const userId = sessions.resolve(token);
  if (userId === null) return null;
  return users.findById(userId);
}
