import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { CampaignListSchema } from '@daggerheart/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CampaignStore } from '../src/campaigns.js';
import { handleCampaigns } from '../src/campaigns-http.js';
import { CharacterStore } from '../src/characters.js';
import { SessionStore } from '../src/sessions.js';
import { UserStore } from '../src/users.js';
import { createUserOrFail } from './helpers.js';

async function startCampaignsServer() {
  const users = new UserStore();
  const sessions = new SessionStore();
  const campaigns = new CampaignStore();
  const http: HttpServer = createServer((request, response) => {
    const characters = new CharacterStore();
    void handleCampaigns(request, response, {
      campaigns,
      characters,
      users,
      sessions,
      persist: () => {},
      broadcast: () => {},
    }).then(
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
    campaigns,
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
    const gm = await createUserOrFail(server.users, 'gm', 'gm-pw', 'gm');
    gmToken = server.sessions.create(gm.id);
    const player = await createUserOrFail(server.users, 'alex', 'player-pw', 'player');
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
    const campaigns = CampaignListSchema.parse(await list.json());
    expect(campaigns.member.some((c) => c.id === summary.id)).toBe(true);

    // A player not yet invited sees no campaigns.
    const playerList = await fetch(`${server.url}/campaigns`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(CampaignListSchema.parse(await playerList.json())).toEqual({ member: [], invited: [] });
  });

  const newCampaign = async (name: string): Promise<string> => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name }),
    });
    return ((await created.json()) as { id: string }).id;
  };

  const post = (token: string, path: string, body?: unknown) =>
    fetch(`${server.url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const listAs = async (token: string) =>
    CampaignListSchema.parse(
      await (await fetch(`${server.url}/campaigns`, { headers: { authorization: `Bearer ${token}` } })).json(),
    );

  it('lets only the owner invite; the player sees it as invited, not as a member', async () => {
    const campaignId = await newCampaign('Otra campaña');

    expect((await post(playerToken, `/campaigns/${campaignId}/invites`, { username: 'alex' })).status).toBe(403);
    expect((await post(gmToken, `/campaigns/${campaignId}/invites`, { username: 'alex' })).status).toBe(204);

    const asPlayer = await listAs(playerToken);
    expect(asPlayer.invited.map((c) => c.id)).toContain(campaignId);
    expect(asPlayer.member.map((c) => c.id)).not.toContain(campaignId);
    // Who else was invited is the GM's business.
    expect(asPlayer.invited.find((c) => c.id === campaignId)?.invitedIds).toEqual([]);

    const asGm = await listAs(gmToken);
    expect(asGm.member.find((c) => c.id === campaignId)?.invitedIds).toEqual([playerId]);
    expect(server.campaigns.roleOf(campaignId, playerId)).toBeNull();
  });

  it('accepting makes the player a member', async () => {
    const campaignId = await newCampaign('Aceptada');
    await post(gmToken, `/campaigns/${campaignId}/invites`, { username: 'alex' });

    expect((await post(playerToken, `/campaigns/${campaignId}/invites/accept`)).status).toBe(204);
    const asPlayer = await listAs(playerToken);
    expect(asPlayer.member.find((c) => c.id === campaignId)?.memberIds).toContain(playerId);
    expect(asPlayer.invited.map((c) => c.id)).not.toContain(campaignId);
    // Inviting a member again is refused.
    expect((await post(gmToken, `/campaigns/${campaignId}/invites`, { username: 'alex' })).status).toBe(409);
  });

  it('declining removes the invitation without joining', async () => {
    const campaignId = await newCampaign('Rechazada');
    await post(gmToken, `/campaigns/${campaignId}/invites`, { username: 'alex' });

    expect((await post(playerToken, `/campaigns/${campaignId}/invites/decline`)).status).toBe(204);
    const asPlayer = await listAs(playerToken);
    expect([...asPlayer.member, ...asPlayer.invited].map((c) => c.id)).not.toContain(campaignId);
    // Nothing left to accept.
    expect((await post(playerToken, `/campaigns/${campaignId}/invites/accept`)).status).toBe(404);
    expect(server.campaigns.roleOf(campaignId, playerId)).toBeNull();
  });

  it('lets the owner cancel a pending invitation', async () => {
    const campaignId = await newCampaign('Cancelada');
    await post(gmToken, `/campaigns/${campaignId}/invites`, { username: 'alex' });

    const forbidden = await fetch(`${server.url}/campaigns/${campaignId}/invites/${playerId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${playerToken}` },
    });
    expect(forbidden.status).toBe(403);
    const cancelled = await fetch(`${server.url}/campaigns/${campaignId}/invites/${playerId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${gmToken}` },
    });
    expect(cancelled.status).toBe(204);
    expect((await listAs(playerToken)).invited.map((c) => c.id)).not.toContain(campaignId);
  });

  it('403s a non-owner inviting a nonexistent username, not 404 — ownership is checked first', async () => {
    const campaignId = await newCampaign('No leak');
    expect((await post(playerToken, `/campaigns/${campaignId}/invites`, { username: 'nobody-here' })).status).toBe(403);
  });

  it('404s inviting an unknown username and 400s a bad body', async () => {
    const campaignId = await newCampaign('Tercera');
    expect((await post(gmToken, `/campaigns/${campaignId}/invites`, { username: 'nobody-here' })).status).toBe(404);
    expect((await post(gmToken, `/campaigns/${campaignId}/invites`, { username: '' })).status).toBe(400);
  });

  it('has no direct add on purpose: invitations are the only way into a campaign', async () => {
    const campaignId = await newCampaign('Directo');
    expect((await post(gmToken, `/campaigns/${campaignId}/players`, { username: 'alex' })).status).toBe(404);
    expect(server.campaigns.roleOf(campaignId, playerId)).toBeNull();
  });

  it('lets the owner remove a member', async () => {
    const created = await fetch(`${server.url}/campaigns`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${gmToken}` },
      body: JSON.stringify({ name: 'Cuarta' }),
    });
    const { id: campaignId } = (await created.json()) as { id: string };
    await post(gmToken, `/campaigns/${campaignId}/invites`, { username: 'alex' });
    await post(playerToken, `/campaigns/${campaignId}/invites/accept`);

    const removed = await fetch(`${server.url}/campaigns/${campaignId}/players/${playerId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${gmToken}` },
    });
    expect(removed.status).toBe(204);

    const playerList = await fetch(`${server.url}/campaigns`, {
      headers: { authorization: `Bearer ${playerToken}` },
    });
    const playerCampaigns = CampaignListSchema.parse(await playerList.json()).member;
    expect(playerCampaigns.some((c) => c.id === campaignId)).toBe(false);
  });
});
