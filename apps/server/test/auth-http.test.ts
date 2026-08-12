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
