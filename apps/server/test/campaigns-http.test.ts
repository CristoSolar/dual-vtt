import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CampaignStore } from '../src/campaigns.js';
import { handleCampaigns } from '../src/campaigns-http.js';
import { SessionStore } from '../src/sessions.js';
import { UserStore } from '../src/users.js';

async function startCampaignsServer() {
  const users = new UserStore();
  const sessions = new SessionStore();
  const campaigns = new CampaignStore();
  const http: HttpServer = createServer((request, response) => {
    void handleCampaigns(request, response, { campaigns, users, sessions, persist: () => {} }).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      },
    );
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

describe('campaigns HTTP endpoints', () => {
  let server: Awaited<ReturnType<typeof startCampaignsServer>>;
  let gmToken: string;
  let playerToken: string;
  let playerId: string;

  beforeAll(async () => {
    server = await startCampaignsServer();
    const gm = await server.users.createUser('gm', 'gm-pw', 'gm');
    gmToken = server.sessions.create(gm.id);
    const player = await server.users.createUser('alex', 'player-pw', 'player');
    playerId = player.id;
    playerToken = server.sessions.create(player.id);
  });

  afterAll(async () => {
    await server.close();
  });

  it('requires a logged-in account to create a campaign', async () => {
    const response = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Grupo Martes' }),
    });
    expect(response.status).toBe(401);
  });

  it('creates a campaign for the logged-in account and lists it back', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Grupo Martes' }),
    });
    expect(created.status).toBe(201);
    const summary = (await created.json()) as { id: string; ownerUsername: string; memberIds: string[] };
    expect(summary.ownerUsername).toBe('gm');
    expect(summary.memberIds).toEqual([]);

    const list = await fetch(`${server.url}/campaigns`, { headers: { authorization: `Bearer ${gmToken}` } });
    const campaigns = (await list.json()) as { id: string }[];
    expect(campaigns.some((c) => c.id === summary.id)).toBe(true);

    // A player not yet added sees no campaigns.
    const playerList = await fetch(`${server.url}/campaigns`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(((await playerList.json()) as unknown[])).toEqual([]);
  });

  it('lets only the owner add a player, then that player sees the campaign', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Otra campaña' }),
    });
    const { id: campaignId } = (await created.json()) as { id: string };

    const forbidden = await fetch(`${server.url}/campaigns/${campaignId}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${playerToken}` },
      body: JSON.stringify({ username: 'alex' }),
    });
    expect(forbidden.status).toBe(403);

    const added = await fetch(`${server.url}/campaigns/${campaignId}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'alex' }),
    });
    expect(added.status).toBe(204);

    const playerList = await fetch(`${server.url}/campaigns`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    const playerCampaigns = (await playerList.json()) as { id: string; memberIds: string[] }[];
    expect(playerCampaigns.some((c) => c.id === campaignId && c.memberIds.includes(playerId))).toBe(true);
  });

  it('404s adding an unknown username', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Tercera' }),
    });
    const { id: campaignId } = (await created.json()) as { id: string };

    const response = await fetch(`${server.url}/campaigns/${campaignId}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'nobody-here' }),
    });
    expect(response.status).toBe(404);
  });

  it('lets the owner remove a member', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Cuarta' }),
    });
    const { id: campaignId } = (await created.json()) as { id: string };
    await fetch(`${server.url}/campaigns/${campaignId}/players`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ username: 'alex' }),
    });

    const removed = await fetch(`${server.url}/campaigns/${campaignId}/players/${playerId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${gmToken}` },
    });
    expect(removed.status).toBe(204);

    const playerList = await fetch(`${server.url}/campaigns`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    const playerCampaigns = (await playerList.json()) as { id: string }[];
    expect(playerCampaigns.some((c) => c.id === campaignId)).toBe(false);
  });
});
