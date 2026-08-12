import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  ChangePasswordRequestSchema,
  CreatePlayerRequestSchema,
  LoginRequestSchema,
  ResetPasswordRequestSchema,
  type User,
} from '@daggerheart/protocol';

import type { SessionStore } from './sessions.js';
import { readBody } from './uploads.js';
import type { UserStore } from './users.js';

const MAX_AUTH_BODY_BYTES = 64 * 1024;

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const noContent = (response: ServerResponse): void => {
  response.writeHead(204);
  response.end();
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const bytes = await readBody(request, MAX_AUTH_BODY_BYTES);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

/** Resolves the caller's account from the request's bearer token. Never from the body. */
function actorFor(request: IncomingMessage, sessions: SessionStore, users: UserStore): User | null {
  const token = bearerToken(request);
  if (token === null) return null;
  const userId = sessions.resolve(token);
  if (userId === null) return null;
  return users.findById(userId);
}

export interface AuthDeps {
  users: UserStore;
  sessions: SessionStore;
  /** Called after any mutation, so the caller can snapshot to disk right away. */
  persist: () => void;
}

/**
 * Handles `/login`, `/logout`, `/me`, `/change-password`, and the GM-only `/users`
 * routes. Mirrors `handleUploads`: returns true when it handled the request, so
 * the caller can fall through to its other routes.
 */
export async function handleAuth(
  request: IncomingMessage,
  response: ServerResponse,
  { users, sessions, persist }: AuthDeps,
): Promise<boolean> {
  const url = request.url ?? '';
  const method = request.method ?? 'GET';

  if (method === 'POST' && url === '/login') {
    const parsed = LoginRequestSchema.safeParse(await readJsonBody(request).catch(() => null));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const user = await users.verifyLogin(parsed.data.username, parsed.data.password);
    if (user === null) {
      json(response, 401, { error: 'invalidCredentials' });
      return true;
    }
    const token = sessions.create(user.id);
    json(response, 200, { token, user });
    return true;
  }

  if (method === 'POST' && url === '/logout') {
    const token = bearerToken(request);
    if (token !== null) sessions.destroy(token);
    noContent(response);
    return true;
  }

  if (method === 'GET' && url === '/me') {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    json(response, 200, actor);
    return true;
  }

  if (method === 'POST' && url === '/change-password') {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    const parsed = ChangePasswordRequestSchema.safeParse(await readJsonBody(request).catch(() => null));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const verified = await users.verifyLogin(actor.username, parsed.data.currentPassword);
    if (verified === null) {
      json(response, 401, { error: 'invalidCredentials' });
      return true;
    }
    await users.setPassword(actor.id, parsed.data.newPassword, false);
    persist();
    noContent(response);
    return true;
  }

  if (method === 'GET' && url === '/users') {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    if (actor.role !== 'gm') {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    json(response, 200, users.list('player'));
    return true;
  }

  if (method === 'POST' && url === '/users') {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    if (actor.role !== 'gm') {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    const parsed = CreatePlayerRequestSchema.safeParse(await readJsonBody(request).catch(() => null));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    if (users.findByUsername(parsed.data.username) !== null) {
      json(response, 409, { error: 'usernameTaken' });
      return true;
    }
    const created = await users.createUser(parsed.data.username, parsed.data.password, 'player');
    persist();
    json(response, 201, created);
    return true;
  }

  const resetMatch = /^\/users\/([^/]+)\/reset-password$/.exec(url);
  if (method === 'POST' && resetMatch !== null) {
    const actor = actorFor(request, sessions, users);
    if (actor === null) {
      json(response, 401, { error: 'unauthorized' });
      return true;
    }
    if (actor.role !== 'gm') {
      json(response, 403, { error: 'forbidden' });
      return true;
    }
    const parsed = ResetPasswordRequestSchema.safeParse(await readJsonBody(request).catch(() => null));
    if (!parsed.success) {
      json(response, 400, { error: 'badRequest' });
      return true;
    }
    const targetId = resetMatch[1] ?? '';
    const ok = await users.setPassword(targetId, parsed.data.newPassword, true);
    if (!ok) {
      json(response, 404, { error: 'notFound' });
      return true;
    }
    persist();
    noContent(response);
    return true;
  }

  return false;
}
