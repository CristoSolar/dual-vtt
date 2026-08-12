# Fase A: Cuentas y login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent user accounts (GM + player) with login, replacing nothing about the current room/join-code flow yet — any logged-in user still uses that exactly as today. This is Phase A of two; Phase B (campaigns) builds on top of these accounts later.

**Architecture:** New wire schemas in `@daggerheart/protocol` (`auth.ts`), a server-side `UserStore` persisted to its own JSON snapshot file (mirroring the existing `RoomStore`/`snapshot.ts` pattern exactly), plain `node:http` endpoints (mirroring `uploads.ts`'s style — no Express), and a web-side login gate in front of the existing app.

**Tech Stack:** TypeScript, Zod, `node:crypto` (scrypt) for password hashing — no new npm dependencies anywhere.

## Global Constraints

- No new dependencies in any package (spec: password hashing uses Node's built-in `crypto.scrypt`, not bcrypt).
- All new user-facing text in Spanish.
- `tsconfig.base.json` strict mode: relative imports use `.js` extensions even in `.ts` source, indexing yields `T | undefined`, optional fields can't be assigned explicit `undefined`, type-only imports use `import type` (or the inline `type` modifier on a named import, which this codebase already uses in `rooms.ts`).
- The password hash never leaves the server: `UserSchema` (the wire type) has no hash field, and every server response is built from that public shape, never from the stored record directly.
- Sessions are in-memory only for this phase — a server restart signs everyone out. This is accepted, not a bug to fix here.
- This phase does not touch `apps/server/src/rooms.ts`, `gateway.ts`, the join-code flow, or `apps/web/src/state/useRoom.ts`'s room logic. Only additions plus one `App.tsx` gating change.
- No linter/formatter exists in this repo — `pnpm -F <pkg> typecheck` is the static gate for every task, and `pnpm -F <pkg> test` for every task with automated tests.

---

### Task 1: Protocol schemas

**Files:**
- Create: `packages/protocol/src/auth.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/auth.test.ts`

**Interfaces:**
- Consumes: nothing new (only `zod`, already a dependency).
- Produces: `UserRoleSchema`/`UserRole`, `UserSchema`/`User` (`{ id, username, role, mustChangePassword }`), `LoginRequestSchema`, `LoginResponseSchema` (`{ token, user }`), `CreatePlayerRequestSchema` (`{ username, password }`), `ChangePasswordRequestSchema` (`{ currentPassword, newPassword }`), `ResetPasswordRequestSchema` (`{ newPassword }`) — all consumed by Tasks 2, 3, 5, 6.

- [ ] **Step 1: Write the schemas**

Create `packages/protocol/src/auth.ts`:

```ts
import { z } from 'zod';

export const UserRoleSchema = z.enum(['gm', 'player']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * What a client is ever allowed to see about an account. The password hash lives
 * only in the server's own storage and never reaches this shape.
 */
export const UserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  role: UserRoleSchema,
  mustChangePassword: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  token: z.string().min(1),
  user: UserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const CreatePlayerRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  newPassword: z.string().min(1),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
```

- [ ] **Step 2: Export it from the package barrel**

In `packages/protocol/src/index.ts`, add one line (the file currently ends with `export * from './map.js';`):

```ts
export * from './auth.js';
```

- [ ] **Step 3: Write the failing tests, then make them pass**

Create `packages/protocol/test/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ChangePasswordRequestSchema,
  CreatePlayerRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  ResetPasswordRequestSchema,
  UserSchema,
} from '../src/index.js';

describe('auth schemas', () => {
  it('accepts a well-formed user', () => {
    const user = { id: 'u-1', username: 'alex', role: 'player', mustChangePassword: false };
    expect(UserSchema.parse(user)).toEqual(user);
  });

  it('rejects a user with an unknown role', () => {
    expect(
      UserSchema.safeParse({ id: 'u-1', username: 'alex', role: 'wizard', mustChangePassword: false })
        .success,
    ).toBe(false);
  });

  it('rejects an empty username or password on login', () => {
    expect(LoginRequestSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ username: 'x', password: '' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ username: 'gm', password: 'gm' }).success).toBe(true);
  });

  it('accepts a login response carrying a token and a user', () => {
    const response = {
      token: 'abc123',
      user: { id: 'u-1', username: 'alex', role: 'gm', mustChangePassword: true },
    };
    expect(LoginResponseSchema.parse(response)).toEqual(response);
  });

  it('validates create-player, change-password, and reset-password payload shapes', () => {
    expect(CreatePlayerRequestSchema.safeParse({ username: 'alex', password: 'x' }).success).toBe(true);
    expect(CreatePlayerRequestSchema.safeParse({ username: 'alex' }).success).toBe(false);
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: 'a', newPassword: 'b' }).success,
    ).toBe(true);
    expect(ResetPasswordRequestSchema.safeParse({ newPassword: 'b' }).success).toBe(true);
    expect(ResetPasswordRequestSchema.safeParse({ newPassword: '' }).success).toBe(false);
  });
});
```

Run: `pnpm -F @daggerheart/protocol test auth`
Expected: all 5 assertions pass (there is no prior failing state to observe here — the schemas are written in Step 1 before this test exists against them, so just confirm green).

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm -F @daggerheart/protocol typecheck`
Expected: no errors.

```bash
git add packages/protocol/src/auth.ts packages/protocol/src/index.ts packages/protocol/test/auth.test.ts
git commit -m "feat: add auth wire schemas (User, login, change/reset password)"
```

---

### Task 2: Password hashing and `UserStore`

**Files:**
- Create: `apps/server/src/passwords.ts`
- Create: `apps/server/src/users.ts`
- Create: `apps/server/src/users-snapshot.ts`
- Test: `apps/server/test/users.test.ts`

**Interfaces:**
- Consumes: `UserRoleSchema`, `type User`, `type UserRole` from `@daggerheart/protocol` (Task 1).
- Produces: `hashPassword(password: string): Promise<string>`, `verifyPasswordHash(password: string, stored: string): Promise<boolean>` (from `passwords.ts`); `class UserStore` with `createUser(username, password, role): Promise<User>`, `verifyLogin(username, password): Promise<User | null>`, `setPassword(userId, newPassword, mustChangePassword): Promise<boolean>`, `findByUsername(username): StoredUser | null`, `findById(id): User | null`, `list(role?): User[]`, `serialize(): StoredUser[]`, `restore(records): void` (from `users.ts`) — all consumed by Task 3 and by `main.ts` in Task 4; `writeUsersSnapshot(path, users): Promise<void>`, `readUsersSnapshot(path): Promise<StoredUser[]>` (from `users-snapshot.ts`) — consumed by Task 4.

- [ ] **Step 1: Write password hashing**

Create `apps/server/src/passwords.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing with Node's built-in scrypt — no bcrypt dependency needed.
 * Stored as `<salt-hex>:<hash-hex>`, one string, so `UserStore` has a single
 * field to persist.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

/** Constant-time compare, so a failed check can't be timed to learn the hash. */
export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(':');
  if (saltHex === undefined || hashHex === undefined) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = await scryptAsync(password, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
```

- [ ] **Step 2: Write `UserStore`**

Create `apps/server/src/users.ts`:

```ts
import { randomBytes } from 'node:crypto';

import type { User, UserRole } from '@daggerheart/protocol';

import { hashPassword, verifyPasswordHash } from './passwords.js';

/** The server-only shape: everything `User` has, plus the hash. Never sent to a client. */
export interface StoredUser extends User {
  passwordHash: string;
}

function toPublic(user: StoredUser): User {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * In-memory account storage, mirroring `RoomStore`'s shape: the single source of
 * truth, with a `serialize`/`restore` pair for the disk snapshot.
 */
export class UserStore {
  private readonly users = new Map<string, StoredUser>();

  get size(): number {
    return this.users.size;
  }

  findByUsername(username: string): StoredUser | null {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    return null;
  }

  findById(id: string): User | null {
    const user = this.users.get(id);
    return user === undefined ? null : toPublic(user);
  }

  list(role?: UserRole): User[] {
    return [...this.users.values()]
      .filter((user) => role === undefined || user.role === role)
      .map(toPublic);
  }

  /** New accounts always start `mustChangePassword: true` — a GM-set password is temporary by design. */
  async createUser(username: string, password: string, role: UserRole): Promise<User> {
    const id = `u-${randomBytes(8).toString('hex')}`;
    const passwordHash = await hashPassword(password);
    const user: StoredUser = { id, username, role, mustChangePassword: true, passwordHash };
    this.users.set(id, user);
    return toPublic(user);
  }

  async verifyLogin(username: string, password: string): Promise<User | null> {
    const stored = this.findByUsername(username);
    if (stored === null) return null;
    const ok = await verifyPasswordHash(password, stored.passwordHash);
    return ok ? toPublic(stored) : null;
  }

  async setPassword(userId: string, newPassword: string, mustChangePassword: boolean): Promise<boolean> {
    const user = this.users.get(userId);
    if (user === undefined) return false;
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = mustChangePassword;
    return true;
  }

  restore(records: readonly StoredUser[]): void {
    for (const record of records) this.users.set(record.id, record);
  }

  /** A JSON-serializable copy of every account, for the disk snapshot. */
  serialize(): StoredUser[] {
    return [...this.users.values()];
  }
}
```

- [ ] **Step 3: Write the snapshot read/write pair**

Create `apps/server/src/users-snapshot.ts` (same structure as `snapshot.ts`, independently — that file hand-writes its own Zod schema mirroring `Session`/`SerializedRoom` rather than importing the store's TS type, and this follows the same convention):

```ts
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { UserRoleSchema } from '@daggerheart/protocol';
import { z } from 'zod';

import type { StoredUser } from './users.js';

const StoredUserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  role: UserRoleSchema,
  mustChangePassword: z.boolean(),
  passwordHash: z.string().min(1),
});

const SnapshotSchema = z.object({
  version: z.literal(1),
  users: z.array(StoredUserSchema),
});

export const USERS_SNAPSHOT_VERSION = 1;

/** Same atomic-write approach as `writeSnapshot`: never leave a truncated file on a crash. */
export async function writeUsersSnapshot(path: string, users: readonly StoredUser[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = JSON.stringify({ version: USERS_SNAPSHOT_VERSION, users });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, payload, 'utf8');
  await rename(temporary, path);
}

export async function readUsersSnapshot(path: string): Promise<StoredUser[]> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }

  try {
    const parsed = SnapshotSchema.safeParse(JSON.parse(raw) as unknown);
    if (!parsed.success) return [];
    return parsed.data.users;
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Write the tests**

Create `apps/server/test/users.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword, verifyPasswordHash } from '../src/passwords.js';
import { UserStore } from '../src/users.js';
import { readUsersSnapshot, writeUsersSnapshot } from '../src/users-snapshot.js';

describe('password hashing', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPasswordHash('correct-horse', hash)).toBe(true);
    expect(await verifyPasswordHash('wrong', hash)).toBe(false);
  });

  it('salts each hash differently, even for the same password', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});

describe('UserStore', () => {
  it('creates a user that must change their password, and never returns the hash', async () => {
    const store = new UserStore();
    const user = await store.createUser('alex', 'initial-pw', 'player');
    expect(user.mustChangePassword).toBe(true);
    expect(user.role).toBe('player');
    expect(JSON.stringify(user)).not.toContain('initial-pw');
    expect('passwordHash' in user).toBe(false);
  });

  it('verifies login against the stored hash', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'initial-pw', 'player');
    expect(await store.verifyLogin('alex', 'initial-pw')).not.toBeNull();
    expect(await store.verifyLogin('alex', 'wrong')).toBeNull();
    expect(await store.verifyLogin('nobody', 'initial-pw')).toBeNull();
  });

  it('changes the password and clears mustChangePassword', async () => {
    const store = new UserStore();
    const created = await store.createUser('alex', 'initial-pw', 'player');
    const ok = await store.setPassword(created.id, 'new-pw', false);
    expect(ok).toBe(true);
    expect(await store.verifyLogin('alex', 'new-pw')).not.toBeNull();
    expect(await store.verifyLogin('alex', 'initial-pw')).toBeNull();
  });

  it('lists only players when filtered by role', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'x', 'player');
    await store.createUser('gm', 'y', 'gm');
    expect(store.list('player').map((u) => u.username)).toEqual(['alex']);
  });

  it('round-trips through serialize/restore', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'initial-pw', 'player');
    await store.createUser('gm', 'gm-pw', 'gm');

    const restored = new UserStore();
    restored.restore(store.serialize());

    expect(restored.list().map((u) => u.username).sort()).toEqual(['alex', 'gm']);
    expect(await restored.verifyLogin('alex', 'initial-pw')).not.toBeNull();
  });
});

describe('users snapshot file', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dh-users-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads back exactly what it wrote', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'initial-pw', 'player');
    const path = join(directory, 'users.json');

    await writeUsersSnapshot(path, store.serialize());
    const restored = await readUsersSnapshot(path);

    const fresh = new UserStore();
    fresh.restore(restored);
    expect(await fresh.verifyLogin('alex', 'initial-pw')).not.toBeNull();
  });

  it('returns an empty array when the file does not exist', async () => {
    expect(await readUsersSnapshot(join(directory, 'missing.json'))).toEqual([]);
  });

  it('discards unreadable JSON instead of throwing', async () => {
    const path = join(directory, 'corrupt.json');
    await writeUsersSnapshot(path, []);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'not json', 'utf8');
    expect(await readUsersSnapshot(path)).toEqual([]);
  });
});
```

Run: `pnpm -F @daggerheart/server test users`
Expected: all tests pass.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm -F @daggerheart/server typecheck`
Expected: no errors.

```bash
git add apps/server/src/passwords.ts apps/server/src/users.ts apps/server/src/users-snapshot.ts apps/server/test/users.test.ts
git commit -m "feat: add password hashing, UserStore, and its disk snapshot"
```

---

### Task 3: Sessions and HTTP endpoints

**Files:**
- Create: `apps/server/src/sessions.ts`
- Create: `apps/server/src/auth-http.ts`
- Test: `apps/server/test/auth-http.test.ts`

**Interfaces:**
- Consumes: `readBody` from `./uploads.js` (already exported, signature `readBody(request: IncomingMessage, limit: number): Promise<Uint8Array>`); `LoginRequestSchema`, `ChangePasswordRequestSchema`, `CreatePlayerRequestSchema`, `ResetPasswordRequestSchema`, `type User` from `@daggerheart/protocol`; `UserStore` from `./users.js` (Task 2).
- Produces: `class SessionStore` with `create(userId): string`, `resolve(token): string | null`, `destroy(token): void`; `handleAuth(request, response, { users, sessions, persist }): Promise<boolean>` — same true/false fallthrough contract as `handleUploads`, consumed by `main.ts` in Task 4.

- [ ] **Step 1: Write the session store**

Create `apps/server/src/sessions.ts`:

```ts
import { randomBytes } from 'node:crypto';

/**
 * Maps a login token to the account it belongs to. In-memory only, unlike room
 * seat tokens: a server restart signing everyone out is an acceptable cost for
 * how rarely this server restarts, and it keeps this phase's trust boundary simple.
 */
export class SessionStore {
  private readonly sessions = new Map<string, string>();

  create(userId: string): string {
    const token = randomBytes(24).toString('hex');
    this.sessions.set(token, userId);
    return token;
  }

  resolve(token: string): string | null {
    return this.sessions.get(token) ?? null;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }
}
```

- [ ] **Step 2: Write the HTTP handler**

Create `apps/server/src/auth-http.ts`:

```ts
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
```

- [ ] **Step 3: Write the tests**

Create `apps/server/test/auth-http.test.ts`:

```ts
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleAuth } from '../src/auth-http.js';
import { SessionStore } from '../src/sessions.js';
import { UserStore } from '../src/users.js';

async function startAuthServer() {
  const users = new UserStore();
  const sessions = new SessionStore();
  const http: HttpServer = createServer((request, response) => {
    void handleAuth(request, response, { users, sessions, persist: () => {} }).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address() as AddressInfo;
  return {
    url: `http://localhost:${address.port}`,
    users,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

describe('auth HTTP endpoints', () => {
  let server: Awaited<ReturnType<typeof startAuthServer>>;

  beforeAll(async () => {
    server = await startAuthServer();
    await server.users.createUser('gm', 'gm-pw', 'gm');
  });

  afterAll(async () => {
    await server.close();
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    const ok = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gm', password: 'gm-pw' }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { token: string; user: { username: string } };
    expect(body.user.username).toBe('gm');
    expect(body.token.length).toBeGreaterThan(8);

    const bad = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gm', password: 'wrong' }),
    });
    expect(bad.status).toBe(401);
  });

  it('rejects /me without a token and accepts it with one', async () => {
    const noToken = await fetch(`${server.url}/me`);
    expect(noToken.status).toBe(401);

    const login = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gm', password: 'gm-pw' }),
    });
    const { token } = (await login.json()) as { token: string };

    const me = await fetch(`${server.url}/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { username: string }).username).toBe('gm');
  });

  it('requires the current password to change it, then the new one works', async () => {
    await server.users.createUser('alex', 'initial-pw', 'player');
    const login = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alex', password: 'initial-pw' }),
    });
    const { token } = (await login.json()) as { token: string };

    const wrongCurrent = await fetch(`${server.url}/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'nope', newPassword: 'new-pw' }),
    });
    expect(wrongCurrent.status).toBe(401);

    const changed = await fetch(`${server.url}/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'initial-pw', newPassword: 'new-pw' }),
    });
    expect(changed.status).toBe(204);

    const reLogin = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alex', password: 'new-pw' }),
    });
    expect(reLogin.status).toBe(200);
  });

  it('creates a player as GM, rejects the same action as a player, and resets a password', async () => {
    const gmLogin = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gm', password: 'gm-pw' }),
    });
    const { token: gmToken } = (await gmLogin.json()) as { token: string };

    const created = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'newplayer', password: 'temp-pw' }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; mustChangePassword: boolean };
    expect(createdBody.mustChangePassword).toBe(true);

    const playerLogin = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'newplayer', password: 'temp-pw' }),
    });
    const { token: playerToken } = (await playerLogin.json()) as { token: string };

    const forbidden = await fetch(`${server.url}/users`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(forbidden.status).toBe(403);

    const list = await fetch(`${server.url}/users`, { headers: { authorization: `Bearer ${gmToken}` } });
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { username: string }[];
    expect(listBody.some((u) => u.username === 'newplayer')).toBe(true);

    const resetOk = await fetch(`${server.url}/users/${createdBody.id}/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ newPassword: 'reset-pw' }),
    });
    expect(resetOk.status).toBe(204);

    const loginAfterReset = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'newplayer', password: 'reset-pw' }),
    });
    expect(loginAfterReset.status).toBe(200);
  });

  it('rejects duplicate usernames', async () => {
    const gmLogin = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gm', password: 'gm-pw' }),
    });
    const { token: gmToken } = (await gmLogin.json()) as { token: string };

    await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'dupe', password: 'x' }),
    });
    const again = await fetch(`${server.url}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'dupe', password: 'y' }),
    });
    expect(again.status).toBe(409);
  });
});
```

Run: `pnpm -F @daggerheart/server test auth-http`
Expected: all tests pass.

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm -F @daggerheart/server typecheck`
Expected: no errors.

```bash
git add apps/server/src/sessions.ts apps/server/src/auth-http.ts apps/server/test/auth-http.test.ts
git commit -m "feat: add login/logout/me/change-password and GM player-management endpoints"
```

---

### Task 4: Wire it into `main.ts`

**Files:**
- Modify: `apps/server/src/main.ts`

**Interfaces:**
- Consumes: `UserStore` (Task 2), `readUsersSnapshot`/`writeUsersSnapshot` (Task 2), `SessionStore` (Task 3), `handleAuth` (Task 3).
- Produces: nothing further downstream — this is the last server-side task. `GM_USERNAME`, `GM_PASSWORD`, `USERS_SNAPSHOT_PATH` env vars, documented the same way `PORT`/`SNAPSHOT_PATH` already are.

- [ ] **Step 1: Replace the whole file**

`apps/server/src/main.ts` currently reads exactly as shown in the codebase today (imports `createServer`, `Server` from socket.io, `registerGateway`, `RoomStore`, snapshot functions, `handleUploads`; defines `PORT`/`SNAPSHOT_PATH`/`SNAPSHOT_INTERVAL_MS`/`UPLOAD_DIR`/`ALLOWED_ORIGINS`; and a `main()` that restores the room snapshot, builds the HTTP server with CORS + `/health` + upload routing, starts socket.io, starts periodic snapshots, and wires shutdown). Replace its entire contents with:

```ts
import { createServer } from 'node:http';

import { Server } from 'socket.io';

import { registerGateway } from './gateway.js';
import { handleAuth } from './auth-http.js';
import { RoomStore } from './rooms.js';
import { SessionStore } from './sessions.js';
import { readSnapshot, startSnapshots, writeSnapshot } from './snapshot.js';
import { handleUploads } from './uploads.js';
import { UserStore } from './users.js';
import { readUsersSnapshot, writeUsersSnapshot } from './users-snapshot.js';

const PORT = Number(process.env.PORT ?? 4000);
const SNAPSHOT_PATH = process.env.SNAPSHOT_PATH ?? '.data/rooms.json';
const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS ?? 15_000);
/** Map images live beside the room snapshots. */
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? '.data/uploads';
const USERS_SNAPSHOT_PATH = process.env.USERS_SNAPSHOT_PATH ?? '.data/users.json';
/** The first GM account, created on boot if no account by this name exists yet. */
const GM_USERNAME = process.env.GM_USERNAME ?? 'gm';
const GM_PASSWORD = process.env.GM_PASSWORD ?? 'gm';

/** The web app's dev server and preview origins. This is a local tool, not public. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter((origin) => origin !== '');

async function main(): Promise<void> {
  const store = new RoomStore();
  store.restore(await readSnapshot(SNAPSHOT_PATH));
  if (store.size > 0) console.log(`restored ${store.size} room(s) from ${SNAPSHOT_PATH}`);

  const users = new UserStore();
  users.restore(await readUsersSnapshot(USERS_SNAPSHOT_PATH));
  const persistUsers = (): void => {
    void writeUsersSnapshot(USERS_SNAPSHOT_PATH, users.serialize()).catch((error: unknown) =>
      console.error('users snapshot failed', error),
    );
  };
  if (users.findByUsername(GM_USERNAME) === null) {
    await users.createUser(GM_USERNAME, GM_PASSWORD, 'gm');
    persistUsers();
    const usingDefaults = GM_USERNAME === 'gm' && GM_PASSWORD === 'gm';
    console.warn(
      `No GM account named "${GM_USERNAME}" existed — created it.` +
        (usingDefaults
          ? ' Using the default gm/gm credentials — set GM_USERNAME and GM_PASSWORD to change them.'
          : ''),
    );
  }
  const sessions = new SessionStore();

  const http = createServer((request, response) => {
    // The web app runs on another origin in development.
    const origin = request.headers.origin;
    if (origin !== undefined && ALLOWED_ORIGINS.includes(origin)) {
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('access-control-allow-headers', 'content-type, authorization');
      response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    // A health probe, so `pnpm dev` can tell the server is actually up.
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, rooms: store.size }));
      return;
    }

    void handleAuth(request, response, { users, sessions, persist: persistUsers }).then((handled) => {
      if (handled) return;
      void handleUploads(request, response, UPLOAD_DIR).then((uploadHandled) => {
        if (uploadHandled) return;
        response.writeHead(404);
        response.end();
      });
    });
  });

  const io = new Server(http, { cors: { origin: ALLOWED_ORIGINS } });
  registerGateway(io, store);

  const stopSnapshots = startSnapshots(store, SNAPSHOT_PATH, SNAPSHOT_INTERVAL_MS, (error) =>
    console.error('snapshot failed', error),
  );

  const shutdown = async (): Promise<void> => {
    stopSnapshots();
    // One last snapshot so a clean stop never loses the table's progress.
    await writeSnapshot(SNAPSHOT_PATH, store.serialize()).catch((error: unknown) =>
      console.error('final snapshot failed', error),
    );
    await io.close();
    http.close();
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  // A busy port is an ordinary mistake (an old instance still running), not a crash
  // worth a stack trace — and an unhandled 'error' here would take the web dev
  // server down with it under `pnpm dev`.
  http.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use — another server is probably still running. ` +
          `Stop it, or start this one with PORT=<other> pnpm dev:server.`,
      );
      process.exit(1);
    }
    throw error;
  });

  http.listen(PORT, () => {
    console.log(`Daggerheart VTT server listening on http://localhost:${PORT}`);
  });
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

The only behavioral changes from today: `access-control-allow-headers` now also allows `authorization` (needed for `/me` etc. to work cross-origin between Vite's `:5173` and the server's `:4000` in development), a `UserStore` is restored/bootstrapped before the HTTP server starts, and every request is offered to `handleAuth` before falling through to uploads/404.

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @daggerheart/server typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

There is no `main.test.ts` in this codebase (the entrypoint isn't unit tested elsewhere either) — verify by hand:

```bash
rm -f .data/users.json  # start clean
pnpm -F @daggerheart/server start &
sleep 1
curl -s http://localhost:4000/health
curl -s -X POST http://localhost:4000/login -H 'content-type: application/json' \
  -d '{"username":"gm","password":"gm"}'
```

Expected: `/health` returns `{"ok":true,"rooms":0}`; `/login` returns `{"token":"...","user":{"id":"...","username":"gm","role":"gm","mustChangePassword":true}}`; the server's stderr printed the "created it... default gm/gm credentials" warning; `.data/users.json` now exists.

Stop the server (`kill %1` or Ctrl+C) and start it again — `/login` with `gm`/`gm` should still work (restored from the snapshot) and the "created it" warning should NOT print a second time.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/main.ts
git commit -m "feat: wire accounts and login into the server entrypoint"
```

---

### Task 5: Web auth state

**Files:**
- Create: `apps/web/src/state/auth.ts`
- Test: `apps/web/test/auth.test.ts`

**Interfaces:**
- Consumes: `UserSchema`, `type User` from `@daggerheart/protocol`; `SERVER_URL` from `../state/useRoom.js` (already exported: `export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000';`); the `fakeStorage()` test helper already in `apps/web/test/helpers.ts`.
- Produces: pure functions `loadAuth(storage): StoredAuth | null`, `saveAuth(storage, auth): void` (type `StoredAuth = { token: string; user: User }`), and the hook `useAuth(storage): AuthConnection` (`{ status: 'loading' | 'signedOut' | 'signedIn', user: User | null, token: string | null, error: string | null, login, logout, changePassword }`) — consumed by Task 6.

- [ ] **Step 1: Write the module**

Create `apps/web/src/state/auth.ts`:

```ts
import { UserSchema, type User } from '@daggerheart/protocol';
import { useCallback, useEffect, useState } from 'react';

import { SERVER_URL } from './useRoom.js';

/**
 * Login session persistence. Same trust-boundary rule as `storage.ts`: a saved
 * payload is checked on read, never cast, so a half-written or stale value
 * surfaces as "not logged in" instead of crashing.
 */

const AUTH_KEY = 'daggerheart-vtt:auth';

export interface StoredAuth {
  token: string;
  user: User;
}

/** The browser storage this module reads and writes. Injected so tests can fake it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadAuth(storage: StorageLike): StoredAuth | null {
  const raw = storage.getItem(AUTH_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { token, user } = parsed as Record<string, unknown>;
  if (typeof token !== 'string' || token === '') return null;

  const parsedUser = UserSchema.safeParse(user);
  if (!parsedUser.success) return null;
  return { token, user: parsedUser.data };
}

export function saveAuth(storage: StorageLike, auth: StoredAuth | null): void {
  if (auth === null) storage.removeItem(AUTH_KEY);
  else storage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthConnection {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

/**
 * Owns the logged-in account. Same shape as `useRoom`: the server decides, this
 * only renders whatever it said and persists the token for next time.
 */
export function useAuth(storage: StorageLike): AuthConnection {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadAuth(storage);
    if (saved === null) {
      setStatus('signedOut');
      return;
    }
    fetch(`${SERVER_URL}/me`, { headers: { authorization: `Bearer ${saved.token}` } })
      .then((response) => {
        if (!response.ok) throw new Error('stale session');
        return response.json() as Promise<unknown>;
      })
      .then((body) => {
        const parsedUser = UserSchema.safeParse(body);
        if (!parsedUser.success) throw new Error('bad response');
        setAuth({ token: saved.token, user: parsedUser.data });
        setStatus('signedIn');
      })
      .catch(() => {
        saveAuth(storage, null);
        setStatus('signedOut');
      });
  }, [storage]);

  const login = useCallback(
    async (username: string, password: string) => {
      setError(null);
      const response = await fetch(`${SERVER_URL}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError('Usuario o contraseña incorrectos.');
        return;
      }
      const body = (await response.json()) as { token: string; user: unknown };
      const parsedUser = UserSchema.safeParse(body.user);
      if (!parsedUser.success) {
        setError('El servidor respondió algo inesperado.');
        return;
      }
      const next: StoredAuth = { token: body.token, user: parsedUser.data };
      saveAuth(storage, next);
      setAuth(next);
      setStatus('signedIn');
    },
    [storage],
  );

  const logout = useCallback(() => {
    const saved = loadAuth(storage);
    saveAuth(storage, null);
    setAuth(null);
    setStatus('signedOut');
    if (saved !== null) {
      void fetch(`${SERVER_URL}/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${saved.token}` },
      });
    }
  }, [storage]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setError(null);
      if (auth === null) return;
      const response = await fetch(`${SERVER_URL}/change-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        setError('La contraseña actual no es correcta.');
        return;
      }
      const next: StoredAuth = { token: auth.token, user: { ...auth.user, mustChangePassword: false } };
      saveAuth(storage, next);
      setAuth(next);
    },
    [auth, storage],
  );

  return {
    status,
    user: auth?.user ?? null,
    token: auth?.token ?? null,
    error,
    login,
    logout,
    changePassword,
  };
}
```

- [ ] **Step 2: Write the test for the pure storage functions**

The hook itself talks to the network — like `useRoom`, it has no dedicated unit test in this codebase (that logic is exercised by the server's own HTTP tests from Task 3, plus manual browser verification in Task 6). What's tested here is the same trust-boundary parsing `storage.test.ts` covers for characters.

Create `apps/web/test/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { loadAuth, saveAuth } from '../src/state/auth.js';
import { fakeStorage } from './helpers.js';

const user = { id: 'u-1', username: 'alex', role: 'player' as const, mustChangePassword: false };

describe('auth storage', () => {
  it('round-trips a saved session', () => {
    const storage = fakeStorage();
    saveAuth(storage, { token: 'tok-123', user });
    expect(loadAuth(storage)).toEqual({ token: 'tok-123', user });
  });

  it('returns null when nothing is saved', () => {
    expect(loadAuth(fakeStorage())).toBeNull();
  });

  it('clears the entry when saving null', () => {
    const storage = fakeStorage();
    saveAuth(storage, { token: 'tok-123', user });
    saveAuth(storage, null);
    expect(loadAuth(storage)).toBeNull();
  });

  it('discards a payload with no token', () => {
    const storage = fakeStorage();
    storage.setItem('daggerheart-vtt:auth', JSON.stringify({ user }));
    expect(loadAuth(storage)).toBeNull();
  });

  it('discards a payload whose user does not match the schema', () => {
    const storage = fakeStorage();
    storage.setItem(
      'daggerheart-vtt:auth',
      JSON.stringify({ token: 'tok-123', user: { id: 'u-1', role: 'wizard' } }),
    );
    expect(loadAuth(storage)).toBeNull();
  });

  it('discards unparseable JSON instead of throwing', () => {
    const storage = fakeStorage();
    storage.setItem('daggerheart-vtt:auth', 'not json');
    expect(loadAuth(storage)).toBeNull();
  });
});
```

Run: `pnpm -F @daggerheart/web test auth`
Expected: all tests pass. If `fakeStorage` is not exported from `apps/web/test/helpers.ts`, check its exact export name there first — the same helper `storage.test.ts` already uses (see `apps/web/test/storage.test.ts:18`).

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm -F @daggerheart/web typecheck`
Expected: no errors.

```bash
git add apps/web/src/state/auth.ts apps/web/test/auth.test.ts
git commit -m "feat: add web login/session state (useAuth)"
```

---

### Task 6: Login gate, change-password screen, and GM player management

**Files:**
- Create: `apps/web/src/routes/LoginRoute.tsx`
- Create: `apps/web/src/routes/ChangePasswordRoute.tsx`
- Create: `apps/web/src/routes/PlayersRoute.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 5); `SERVER_URL` from `./state/useRoom.js`; `type User` from `@daggerheart/protocol`.
- Produces: nothing further downstream — last task of this phase.

- [ ] **Step 1: `LoginRoute`**

Create `apps/web/src/routes/LoginRoute.tsx`:

```tsx
import { useState } from 'react';

interface LoginRouteProps {
  error: string | null;
  onLogin: (username: string, password: string) => void;
}

/** The front door when nobody is logged in yet. Nothing past this point is reachable. */
export function LoginRoute({ error, onLogin }: LoginRouteProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    if (username.trim() === '' || password === '') return;
    onLogin(username.trim(), password);
  };

  return (
    <section>
      <div className="hero">
        <h1>DAGGERHEART VTT</h1>
        <p className="muted">Ingresa con la cuenta que te dio tu DJ.</p>
      </div>
      <div className="panel">
        <label htmlFor="login-username">Usuario</label>
        <input
          id="login-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="usuario"
        />
        <label htmlFor="login-password" className="mt-3">
          Contraseña
        </label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
        />
        <div className="mt-3">
          <button type="button" disabled={username.trim() === '' || password === ''} onClick={submit}>
            Entrar
          </button>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: `ChangePasswordRoute`**

Create `apps/web/src/routes/ChangePasswordRoute.tsx`:

```tsx
import { useState } from 'react';

interface ChangePasswordRouteProps {
  error: string | null;
  onChange: (currentPassword: string, newPassword: string) => void;
}

/** Forced screen right after login when the account's password is still the GM-set one. */
export function ChangePasswordRoute({ error, onChange }: ChangePasswordRouteProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  return (
    <section>
      <div className="hero">
        <h1>Cambia tu contraseña</h1>
        <p className="muted">Tu DJ creó esta cuenta con una contraseña inicial. Elige una nueva.</p>
      </div>
      <div className="panel">
        <label htmlFor="current-password">Contraseña actual</label>
        <input
          id="current-password"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <label htmlFor="new-password" className="mt-3">
          Contraseña nueva
        </label>
        <input
          id="new-password"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <div className="mt-3">
          <button
            type="button"
            disabled={currentPassword === '' || newPassword === ''}
            onClick={() => onChange(currentPassword, newPassword)}
          >
            Guardar contraseña
          </button>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: `PlayersRoute`**

Create `apps/web/src/routes/PlayersRoute.tsx`:

```tsx
import type { User } from '@daggerheart/protocol';
import { useEffect, useState } from 'react';

import { SERVER_URL } from '../state/useRoom.js';

interface PlayersRouteProps {
  token: string;
}

/** GM-only: create and manage the player accounts for this install. */
export function PlayersRoute({ token }: PlayersRouteProps) {
  const [players, setPlayers] = useState<readonly User[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const authHeader = { authorization: `Bearer ${token}` };

  const reload = (): void => {
    fetch(`${SERVER_URL}/users`, { headers: authHeader })
      .then((response) => (response.ok ? (response.json() as Promise<User[]>) : Promise.reject()))
      .then(setPlayers)
      .catch(() => setError('No se pudo cargar la lista de jugadores.'));
  };

  useEffect(reload, []);

  const createPlayer = async (): Promise<void> => {
    setError(null);
    const response = await fetch(`${SERVER_URL}/users`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!response.ok) {
      setError(response.status === 409 ? 'Ese usuario ya existe.' : 'No se pudo crear el jugador.');
      return;
    }
    setUsername('');
    setPassword('');
    reload();
  };

  const resetPassword = async (id: string): Promise<void> => {
    const newPassword = window.prompt('Nueva contraseña temporal para este jugador:');
    if (newPassword === null || newPassword === '') return;
    const response = await fetch(`${SERVER_URL}/users/${id}/reset-password`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword }),
    });
    if (!response.ok) setError('No se pudo resetear la contraseña.');
  };

  return (
    <section>
      <div className="hero">
        <h1>Jugadores</h1>
        <p className="muted">Crea una cuenta para cada jugador de tu mesa.</p>
      </div>

      <div className="panel">
        <h2>Crear jugador</h2>
        <label htmlFor="new-player-username">Usuario</label>
        <input id="new-player-username" value={username} onChange={(event) => setUsername(event.target.value)} />
        <label htmlFor="new-player-password" className="mt-3">
          Contraseña inicial
        </label>
        <input
          id="new-player-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <div className="mt-3">
          <button
            type="button"
            disabled={username.trim() === '' || password === ''}
            onClick={createPlayer}
          >
            Crear jugador
          </button>
        </div>
        {error !== null ? <div className="errors">{error}</div> : null}
      </div>

      <div className="panel">
        <h2>Jugadores existentes</h2>
        {players.length === 0 ? (
          <p className="muted">Todavía no creaste ningún jugador.</p>
        ) : (
          <ul>
            {players.map((player) => (
              <li key={player.id} className="row spread">
                <span>
                  {player.username}
                  {player.mustChangePassword ? ' (debe cambiar su contraseña)' : ''}
                </span>
                <button type="button" onClick={() => resetPassword(player.id)}>
                  Resetear contraseña
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Gate `App.tsx` behind login**

In `apps/web/src/App.tsx`, add the imports (alongside the existing route imports at the top):

```ts
import { ChangePasswordRoute } from './routes/ChangePasswordRoute.js';
import { LoginRoute } from './routes/LoginRoute.js';
import { PlayersRoute } from './routes/PlayersRoute.js';
import { useAuth } from './state/auth.js';
```

Inside `Shell()`, right after the existing `const room = useRoom(storage);` line, add:

```ts
const auth = useAuth(storage);
```

Immediately after the `hasCreationInProgress`/`isGameMaster`/`inCampaign` block (right before the `return (` that builds the JSX — i.e. right after the existing `const claimActive = useCallback(...)` block), add the gating:

```tsx
if (auth.status === 'loading') {
  return (
    <div className="app">
      <p className="muted">Cargando…</p>
    </div>
  );
}

if (auth.status === 'signedOut') {
  return <LoginRoute error={auth.error} onLogin={auth.login} />;
}

if (auth.user?.mustChangePassword === true) {
  return <ChangePasswordRoute error={auth.error} onChange={auth.changePassword} />;
}
```

In the `<nav>` block, add a "Jugadores" link for the GM and a "Cerrar sesión" button, right after the existing `Inicio` link and before the `{inCampaign ? (`:

```tsx
<Link to="/">
  <button type="button">Inicio</button>
</Link>
{auth.user?.role === 'gm' ? (
  <Link to="/players">
    <button type="button">Jugadores</button>
  </Link>
) : null}
```

And at the end of the `<nav>` block, right before its closing `</nav>`, add:

```tsx
<button type="button" onClick={auth.logout}>
  Cerrar sesión
</button>
```

Inside `<Routes>`, add a new route — place it next to the other top-level routes, e.g. right after the `/characters` route:

```tsx
<Route
  path="/players"
  element={
    auth.user?.role !== 'gm' || auth.token === null ? (
      <Navigate to="/" replace />
    ) : (
      <PlayersRoute token={auth.token} />
    )
  }
/>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @daggerheart/web typecheck`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run both services (`pnpm -F @daggerheart/server start`, `pnpm -F @daggerheart/web dev`), then in the browser:

1. Opening the app shows the login screen (not the home screen).
2. Logging in with `gm`/`gm` (or whatever `GM_USERNAME`/`GM_PASSWORD` were set to) succeeds and immediately shows the forced change-password screen (since the bootstrap account has `mustChangePassword: true`).
3. Changing the password succeeds and lands on the normal home screen; a "Jugadores" link is visible in the nav.
4. On "Jugadores", create a player account; it appears in the list with "(debe cambiar su contraseña)".
5. Open a private/incognito window, log in as that new player with the temporary password — forced to the change-password screen, changes it, lands on the home screen with no "Jugadores" link (not a GM).
6. "Cerrar sesión" in either window returns to the login screen; reloading the page while logged in stays logged in (session restored from `localStorage` via `/me`).
7. The existing create/join-room flow (still unwired to accounts, as this phase intentionally leaves it) still works exactly as before for either logged-in account.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/routes/LoginRoute.tsx apps/web/src/routes/ChangePasswordRoute.tsx apps/web/src/routes/PlayersRoute.tsx apps/web/src/App.tsx
git commit -m "feat: gate the app behind login, add change-password and player-management screens"
```
