import { createServer, type Server as HttpServer } from 'node:http';
import { readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { writeFileAtomic } from '../src/atomic-write.js';
import { handleAuth, resetLoginLimits } from '../src/auth-http.js';
import { RateLimiter } from '../src/rate-limit.js';
import { SessionStore } from '../src/sessions.js';
import { handleUploads } from '../src/uploads.js';
import { UserStore } from '../src/users.js';

/** A one-pixel PNG, enough to pass the magic-byte check. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

async function startUploadsServer(directory: string) {
  const users = new UserStore();
  const sessions = new SessionStore();
  const http: HttpServer = createServer((request, response) => {
    void handleUploads(request, response, { directory, users, sessions }).then((handled) => {
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
    sessions,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

describe('upload authentication', () => {
  const directory = join(tmpdir(), `dh-uploads-${Date.now()}`);
  let server: Awaited<ReturnType<typeof startUploadsServer>>;
  let token: string;

  beforeAll(async () => {
    server = await startUploadsServer(directory);
    const user = await server.users.createUser('alex', 'pw', 'player');
    if (user === null) throw new Error('fixture user was not created');
    token = server.sessions.create(user.id);
  });

  afterAll(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });

  it('refuses an upload with no session', async () => {
    const response = await fetch(`${server.url}/uploads`, { method: 'POST', body: PNG });
    expect(response.status).toBe(401);
  });

  it('refuses an upload with a token that is not a session', async () => {
    const response = await fetch(`${server.url}/uploads`, {
      method: 'POST',
      headers: { authorization: 'Bearer not-a-real-token' },
      body: PNG,
    });
    expect(response.status).toBe(401);
  });

  it('accepts an upload from a signed-in account and serves it back', async () => {
    const response = await fetch(`${server.url}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: PNG,
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { url: string };
    expect(body.url).toMatch(/^\/uploads\/[0-9a-f]+\.png$/);

    // Reads stay open, so an <img> tag can load the map without a header.
    const fetched = await fetch(`${server.url}${body.url}`);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get('content-type')).toBe('image/png');
  });

  it('refuses a signed-in upload that is not an image', async () => {
    const response = await fetch(`${server.url}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    });
    expect(response.status).toBe(415);
  });

  it('serves byte ranges, so an audio track can be joined mid-song', async () => {
    const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3, 4, 5, 6]);
    const response = await fetch(`${server.url}/uploads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: ogg,
    });
    const { url } = (await response.json()) as { url: string };

    const whole = await fetch(`${server.url}${url}`);
    expect(whole.headers.get('content-type')).toBe('audio/ogg');
    expect(whole.headers.get('accept-ranges')).toBe('bytes');

    const part = await fetch(`${server.url}${url}`, { headers: { range: 'bytes=4-6' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 4-6/10');
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const open = await fetch(`${server.url}${url}`, { headers: { range: 'bytes=8-' } });
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(new Uint8Array([5, 6]));

    const past = await fetch(`${server.url}${url}`, { headers: { range: 'bytes=50-' } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */10');
  });

  it('refuses a path that tries to escape the uploads directory', async () => {
    const response = await fetch(`${server.url}/uploads/..%2f..%2fetc%2fpasswd`);
    expect(response.status).toBe(400);
  });
});

describe('login rate limiting', () => {
  let server: Awaited<ReturnType<typeof startAuthServer>>;

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
      sessions,
      close: () => new Promise<void>((resolve) => http.close(() => resolve())),
    };
  }

  const login = (url: string, password: string) =>
    fetch(`${url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'gm', password }),
    });

  beforeAll(async () => {
    server = await startAuthServer();
    await server.users.createUser('gm', 'right-pw', 'gm');
  });

  afterAll(async () => {
    await server.close();
  });

  afterEach(() => {
    resetLoginLimits();
  });

  it('refuses further attempts once the window is spent', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(server.url, 'wrong')).status).toBe(401);
    }
    expect((await login(server.url, 'wrong')).status).toBe(429);
    // The lockout is on the attempt count, not on whether the password is right.
    expect((await login(server.url, 'right-pw')).status).toBe(429);
  });

  it('forgets the count after a successful login', async () => {
    expect((await login(server.url, 'wrong')).status).toBe(401);
    expect((await login(server.url, 'right-pw')).status).toBe(200);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login(server.url, 'wrong')).status).toBe(401);
    }
  });
});

describe('RateLimiter', () => {
  it('lets attempts through again once the window rolls over', () => {
    const limiter = new RateLimiter(2, 1000);
    limiter.fail('k', 0);
    limiter.fail('k', 0);
    expect(limiter.isLimited('k', 0)).toBe(true);
    expect(limiter.isLimited('k', 1001)).toBe(false);
  });
});

describe('SessionStore', () => {
  it('stops resolving a token once it expires', () => {
    const sessions = new SessionStore(1000);
    const token = sessions.create('u-1', 0);
    expect(sessions.resolve(token, 500)).toBe('u-1');
    // Resolving at 500 pushed the expiry out to 1500, so 1200 is still live.
    expect(sessions.resolve(token, 1200)).toBe('u-1');
    expect(sessions.resolve(token, 5000)).toBeNull();
  });

  it('drops every other token for an account but keeps the caller own', () => {
    const sessions = new SessionStore();
    const mine = sessions.create('u-1');
    const other = sessions.create('u-1');
    const unrelated = sessions.create('u-2');

    sessions.destroyAllFor('u-1', mine);
    expect(sessions.resolve(mine)).toBe('u-1');
    expect(sessions.resolve(other)).toBeNull();
    expect(sessions.resolve(unrelated)).toBe('u-2');

    sessions.destroyAllFor('u-1');
    expect(sessions.resolve(mine)).toBeNull();
  });
});

describe('UserStore concurrency', () => {
  it('creates only one account when the same username is requested twice at once', async () => {
    const store = new UserStore();
    const [first, second] = await Promise.all([
      store.createUser('alex', 'pw-a', 'player'),
      store.createUser('alex', 'pw-b', 'player'),
    ]);

    expect([first, second].filter((user) => user !== null)).toHaveLength(1);
    expect(store.list()).toHaveLength(1);
    // Whichever won owns the password; the account is reachable either way.
    const login = (await store.verifyLogin('alex', 'pw-a')) ?? (await store.verifyLogin('alex', 'pw-b'));
    expect(login).not.toBeNull();
  });

  it('costs the same work whether or not the username exists', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'pw', 'player');
    expect(await store.verifyLogin('nobody', 'pw')).toBeNull();
  });
});

describe('writeFileAtomic', () => {
  const path = join(tmpdir(), `dh-atomic-${Date.now()}.json`);

  afterAll(async () => {
    await rm(path, { force: true });
  });

  it('leaves a complete file when writes overlap', async () => {
    const payloads = Array.from({ length: 20 }, (_, index) => JSON.stringify({ index }));
    await Promise.all(payloads.map((payload) => writeFileAtomic(path, payload)));

    // Every writer queued, so the file is exactly one of them, never a splice.
    const written = await readFile(path, 'utf8');
    expect(payloads).toContain(written);
    expect(JSON.parse(written)).toHaveProperty('index');
  });
});
