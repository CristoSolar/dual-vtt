import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SessionStore } from '../src/sessions.js';
import { handleTunnel } from '../src/tunnel-http.js';
import { TunnelManager } from '../src/tunnel.js';
import { UserStore } from '../src/users.js';

/**
 * Never opens a real tunnel — `ensure`/`getUrl` are replaced with fakes, the same
 * way `helpers.ts`'s `startTestServer` rebinds `CampaignStore.createCampaign` for
 * a deterministic seed. `TunnelManager`'s constructor args are irrelevant here
 * since `start()` is never reached.
 */
function fakeTunnel(url: string | null): TunnelManager {
  const tunnel = new TunnelManager(4000, '/nonexistent');
  tunnel.getUrl = () => url;
  tunnel.ensure = async () => {
    if (url === null) throw new Error('no url configured for this fake');
    return url;
  };
  return tunnel;
}

async function startTunnelServer(tunnel: TunnelManager) {
  const users = new UserStore();
  const sessions = new SessionStore();
  const http: HttpServer = createServer((request, response) => {
    void handleTunnel(request, response, { tunnel, users, sessions }).then((handled) => {
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

describe('the /tunnel endpoint', () => {
  let server: Awaited<ReturnType<typeof startTunnelServer>>;
  let gmToken: string;
  let playerToken: string;

  beforeAll(async () => {
    server = await startTunnelServer(fakeTunnel('https://example.trycloudflare.com'));
    const gm = await server.users.createUser('gm', 'gm-pw', 'gm');
    gmToken = server.sessions.create(gm.id);
    const player = await server.users.createUser('alex', 'player-pw', 'player');
    playerToken = server.sessions.create(player.id);
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects a request with no token', async () => {
    const response = await fetch(`${server.url}/tunnel`);
    expect(response.status).toBe(401);
  });

  it('rejects a player, GM-only whether checking or starting', async () => {
    const get = await fetch(`${server.url}/tunnel`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(get.status).toBe(401);

    const post = await fetch(`${server.url}/tunnel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(post.status).toBe(401);
  });

  it('lets the GM check and start the tunnel, returning the same URL either way', async () => {
    const get = await fetch(`${server.url}/tunnel`, { headers: { authorization: `Bearer ${gmToken}` } });
    expect(get.status).toBe(200);
    expect((await get.json()) as { url: string | null }).toEqual({ url: 'https://example.trycloudflare.com' });

    const post = await fetch(`${server.url}/tunnel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${gmToken}` },
    });
    expect(post.status).toBe(200);
    expect((await post.json()) as { url: string }).toEqual({ url: 'https://example.trycloudflare.com' });
  });
});

describe('the /tunnel endpoint when starting fails', () => {
  it('reports 502 with a message, not a crash', async () => {
    const server = await startTunnelServer(fakeTunnel(null));
    const gm = await server.users.createUser('gm', 'gm-pw', 'gm');
    const gmToken = server.sessions.create(gm.id);

    try {
      const response = await fetch(`${server.url}/tunnel`, {
        method: 'POST',
        headers: { authorization: `Bearer ${gmToken}` },
      });
      expect(response.status).toBe(502);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe('tunnelFailed');
    } finally {
      await server.close();
    }
  });
});
