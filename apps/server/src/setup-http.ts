import type { IncomingMessage, ServerResponse } from 'node:http';

import { SetupRequestSchema } from '@daggerheart/protocol';

import { json, readJsonBody } from './http-json.js';
import { RateLimiter } from './rate-limit.js';
import type { SessionStore } from './sessions.js';
import type { UserStore } from './users.js';

/**
 * Attempts per address before it is refused for a while. A valid request succeeds
 * once and closes the door, so this only bounds junk.
 */
const SETUP_ATTEMPTS = 10;
const SETUP_WINDOW_MS = 60_000;
const setupLimiter = new RateLimiter(SETUP_ATTEMPTS, SETUP_WINDOW_MS);

/** Exported for tests, which would otherwise carry a lockout between cases. */
export function resetSetupLimits(): void {
  setupLimiter.clear();
}

export interface SetupDeps {
  users: UserStore;
  sessions: SessionStore;
  /** Off for `pnpm start`/`host`/Docker, which create their GM from env vars. */
  enabled: boolean;
  persist: () => void;
}

/**
 * Only the machine running the server may create its first GM. The desktop app
 * listens on every interface so the LAN can join, and someone else on the network
 * must not be able to claim the table before its owner opens the window. (The
 * tunnel also arrives from loopback, but it cannot be opened without a GM.)
 */
export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * `GET /setup` and `POST /setup`: the first-run door for the desktop app. Open only
 * while `enabled` and no GM account exists; afterwards GET answers `needsSetup:
 * false` and POST answers 409 forever.
 */
export async function handleSetup(
  request: IncomingMessage,
  response: ServerResponse,
  { users, sessions, enabled, persist }: SetupDeps,
): Promise<boolean> {
  if (request.url !== '/setup') return false;
  const needsSetup = (): boolean => enabled && users.list('gm').length === 0;

  if (request.method === 'GET') {
    json(response, 200, { needsSetup: needsSetup() });
    return true;
  }
  if (request.method !== 'POST') return false;

  const address = request.socket.remoteAddress ?? '?';
  if (setupLimiter.isLimited(address)) {
    json(response, 429, { error: 'tooManyAttempts' });
    return true;
  }
  if (!needsSetup()) {
    setupLimiter.fail(address);
    json(response, 409, { error: 'alreadySetUp' });
    return true;
  }
  if (!isLoopback(request.socket.remoteAddress)) {
    setupLimiter.fail(address);
    json(response, 403, { error: 'forbidden' });
    return true;
  }
  const parsed = SetupRequestSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    setupLimiter.fail(address);
    json(response, 400, { error: 'badRequest' });
    return true;
  }
  // Checked again after the body arrived: two requests racing through the await
  // above must not both create a GM. `createUser` inserts synchronously, so the
  // first one through here closes the door for the second.
  if (!needsSetup()) {
    json(response, 409, { error: 'alreadySetUp' });
    return true;
  }
  const created = await users.createUser(parsed.data.username, parsed.data.password, 'gm', null, false);
  if (created === null) {
    json(response, 409, { error: 'alreadySetUp' });
    return true;
  }
  persist();
  json(response, 201, { token: sessions.create(created.id), user: created });
  return true;
}
