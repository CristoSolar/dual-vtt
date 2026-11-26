import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SessionStore } from '../src/sessions.js';
import { handleSetup, isLoopback, resetSetupLimits } from '../src/setup-http.js';
import { UserStore } from '../src/users.js';

async function startSetupServer(enabled: boolean) {
  const users = new UserStore();
  const sessions = new SessionStore();
  let persisted = 0;
  const http: HttpServer = createServer((request, response) => {
    void handleSetup(request, response, { users, sessions, enabled, persist: () => (persisted += 1) }).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      },
    );
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    users,
    sessions,
    persisted: () => persisted,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

const post = (url: string, body: unknown) =>
  fetch(`${url}/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('first-run setup route', () => {
  let server: Awaited<ReturnType<typeof startSetupServer>>;

  beforeEach(() => resetSetupLimits());
  afterEach(async () => {
    await server.close();
  });

  it('creates the first GM once, signed in, with no forced password change', async () => {
    server = await startSetupServer(true);
    const before = (await (await fetch(`${server.url}/setup`)).json()) as { needsSetup: boolean };
    expect(before.needsSetup).toBe(true);

    const created = await post(server.url, { username: '  Directora ', password: 'una-clave-larga' });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { token: string; user: { id: string; username: string; role: string; mustChangePassword: boolean } };
    expect(body.user).toMatchObject({ username: 'Directora', role: 'gm', mustChangePassword: false });
    expect(server.sessions.resolve(body.token)).toBe(body.user.id);
    expect(server.persisted()).toBe(1);
    expect(await server.users.verifyLogin('directora', 'una-clave-larga')).not.toBeNull();

    const after = (await (await fetch(`${server.url}/setup`)).json()) as { needsSetup: boolean };
    expect(after.needsSetup).toBe(false);
  });

  it('refuses once a GM exists', async () => {
    server = await startSetupServer(true);
    await server.users.createUser('gm', 'whatever-pw', 'gm');
    const again = await post(server.url, { username: 'intruso', password: 'otra-clave-larga' });
    expect(again.status).toBe(409);
    expect(server.users.findByUsername('intruso')).toBeNull();
  });

  it('a second request after a successful one is refused', async () => {
    server = await startSetupServer(true);
    expect((await post(server.url, { username: 'gm1', password: 'clave-larga-1' })).status).toBe(201);
    expect((await post(server.url, { username: 'gm2', password: 'clave-larga-2' })).status).toBe(409);
    expect(server.users.list('gm')).toHaveLength(1);
  });

  it('two racing requests create exactly one GM', async () => {
    server = await startSetupServer(true);
    const results = await Promise.all([
      post(server.url, { username: 'ana', password: 'clave-larga-1' }),
      post(server.url, { username: 'beto', password: 'clave-larga-2' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(server.users.list('gm')).toHaveLength(1);
  });

  it('validates the body: short password, blank or long username, junk', async () => {
    server = await startSetupServer(true);
    expect((await post(server.url, { username: 'gm', password: 'short' })).status).toBe(400);
    expect((await post(server.url, { username: '   ', password: 'long-enough-pw' })).status).toBe(400);
    expect((await post(server.url, { username: 'x'.repeat(41), password: 'long-enough-pw' })).status).toBe(400);
    expect((await post(server.url, 'nope')).status).toBe(400);
    expect(server.users.size).toBe(0);
  });

  it('rate-limits repeated bad attempts', async () => {
    server = await startSetupServer(true);
    for (let i = 0; i < 10; i += 1) {
      expect((await post(server.url, { username: 'gm', password: 'x' })).status).toBe(400);
    }
    expect((await post(server.url, { username: 'gm', password: 'long-enough-pw' })).status).toBe(429);
  });

  it('is closed when the server boots its GM from env vars', async () => {
    server = await startSetupServer(false);
    const status = (await (await fetch(`${server.url}/setup`)).json()) as { needsSetup: boolean };
    expect(status.needsSetup).toBe(false);
    expect((await post(server.url, { username: 'gm', password: 'long-enough-pw' })).status).toBe(409);
    expect(server.users.size).toBe(0);
  });

  it('only loopback addresses count as the local machine', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});
