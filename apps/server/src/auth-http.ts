import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  ChangePasswordRequestSchema,
  CreatePlayerRequestSchema,
  LoginRequestSchema,
  ResetPasswordRequestSchema,
  type User,
} from '@daggerheart/protocol';

import { actorFor, bearerToken } from './http-auth.js';
import { RateLimiter } from './rate-limit.js';
import type { SessionStore } from './sessions.js';
import { readBody } from './uploads.js';
import type { UserStore } from './users.js';

const MAX_AUTH_BODY_BYTES = 64 * 1024;

/**
 * Password guessing is the one thing a public tunnel exposes to the whole internet,
 * so failed logins are counted per address and username and refused for a while.
 */
const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 60_000;
const loginLimiter = new RateLimiter(LOGIN_ATTEMPTS, LOGIN_WINDOW_MS);

/** Exported for tests, which would otherwise carry a lockout between cases. */
export function resetLoginLimits(): void {
  loginLimiter.clear();
}

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
    const key = `${request.socket.remoteAddress ?? '?'}:${parsed.data.username}`;
    if (loginLimiter.isLimited(key)) {
      json(response, 429, { error: 'tooManyAttempts' });
      return true;
    }
    const user = await users.verifyLogin(parsed.data.username, parsed.data.password);
    if (user === null) {
      loginLimiter.fail(key);
      json(response, 401, { error: 'invalidCredentials' });
      return true;
    }
    loginLimiter.succeed(key);
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
    // Every other token for this account dies with the old password; the caller
    // keeps the one they are holding so they are not signed out mid-change.
    sessions.destroyAllFor(actor.id, bearerToken(request) ?? undefined);
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
    if (created === null) {
      json(response, 409, { error: 'usernameTaken' });
      return true;
    }
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
    // The old password is gone, so any token issued against it must go too.
    sessions.destroyAllFor(targetId);
    persist();
    noContent(response);
    return true;
  }

  return false;
}
