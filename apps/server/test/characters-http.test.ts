import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LibraryCharacterSchema, LibraryListSchema, type LibraryCharacter } from '@daggerheart/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CampaignStore } from '../src/campaigns.js';
import { handleCampaigns } from '../src/campaigns-http.js';
import { CharacterStore } from '../src/characters.js';
import { handleCharacters } from '../src/characters-http.js';
import { SessionStore } from '../src/sessions.js';
import { UserStore } from '../src/users.js';
import { buildSheet, createUserOrFail } from './helpers.js';

async function startServer() {
  const users = new UserStore();
  const sessions = new SessionStore();
  const campaigns = new CampaignStore();
  const characters = new CharacterStore();
  const broadcasts: string[] = [];
  let persists = 0;
  const deps = {
    campaigns,
    characters,
    users,
    sessions,
    persist: () => {
      persists += 1;
    },
    broadcast: (campaignId: string) => {
      broadcasts.push(campaignId);
    },
  };
  const http: HttpServer = createServer((request, response) => {
    void (async () => {
      if (await handleCharacters(request, response, deps)) return;
      if (await handleCampaigns(request, response, deps)) return;
      response.writeHead(404);
      response.end();
    })();
  });
  await new Promise<void>((resolve) => http.listen(0, resolve));
  const address = http.address() as AddressInfo;
  return {
    url: `http://localhost:${address.port}`,
    users,
    sessions,
    campaigns,
    characters,
    broadcasts,
    persistCount: () => persists,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

describe('character library HTTP', () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  let alex: string;
  let alexId: string;
  let sam: string;
  let gm: string;
  let gmId: string;

  const call = (token: string | null, method: string, path: string, body?: unknown) =>
    fetch(`${server.url}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const create = async (token: string): Promise<LibraryCharacter> => {
    const response = await call(token, 'POST', '/characters', { sheet: buildSheet() });
    expect(response.status).toBe(201);
    return LibraryCharacterSchema.parse(await response.json());
  };

  const campaignWithAlex = (name: string): string => {
    const campaign = server.campaigns.createCampaign(gmId, 'gm', name);
    server.campaigns.addMember(campaign.id, gmId, alexId);
    return campaign.id;
  };

  beforeAll(async () => {
    server = await startServer();
    const gmUser = await createUserOrFail(server.users, 'gm', 'pw', 'gm');
    gmId = gmUser.id;
    gm = server.sessions.create(gmUser.id);
    const alexUser = await createUserOrFail(server.users, 'alex', 'pw', 'player');
    alexId = alexUser.id;
    alex = server.sessions.create(alexUser.id);
    sam = server.sessions.create((await createUserOrFail(server.users, 'sam', 'pw', 'player')).id);
  });

  afterAll(async () => {
    await server.close();
  });

  it('needs a login', async () => {
    expect((await call(null, 'GET', '/characters')).status).toBe(401);
    expect((await call(null, 'POST', '/characters', { sheet: buildSheet() })).status).toBe(401);
  });

  it('rejects a body that is not a sheet', async () => {
    expect((await call(alex, 'POST', '/characters', { sheet: { name: 'x' } })).status).toBe(400);
  });

  it('creates characters in my library and lists only mine', async () => {
    const before = server.persistCount();
    const created = await create(alex);
    expect(created.campaignId).toBeNull();
    expect(server.persistCount()).toBeGreaterThan(before);

    const mine = LibraryListSchema.parse(await (await call(alex, 'GET', '/characters')).json());
    expect(mine.some((c) => c.id === created.id)).toBe(true);
    const theirs = LibraryListSchema.parse(await (await call(sam, 'GET', '/characters')).json());
    expect(theirs.some((c) => c.id === created.id)).toBe(false);
  });

  it('lets only the owner delete, and only while unlinked', async () => {
    const created = await create(alex);
    expect((await call(sam, 'DELETE', `/characters/${created.id}`)).status).toBe(404);

    const campaignId = campaignWithAlex('Borrar');
    expect((await call(alex, 'POST', `/characters/${created.id}/link`, { campaignId })).status).toBe(200);
    expect((await call(alex, 'DELETE', `/characters/${created.id}`)).status).toBe(409);

    await call(alex, 'POST', `/characters/${created.id}/unlink`);
    expect((await call(alex, 'DELETE', `/characters/${created.id}`)).status).toBe(204);
    expect(server.characters.get(created.id)).toBeNull();
  });

  it('links into a campaign I play in and broadcasts the room change', async () => {
    const created = await create(alex);
    const campaignId = campaignWithAlex('Martes');

    const linked = await call(alex, 'POST', `/characters/${created.id}/link`, { campaignId });
    expect(linked.status).toBe(200);
    const body = LibraryCharacterSchema.parse(await linked.json());
    expect(body).toMatchObject({ campaignId, campaignName: 'Martes' });
    expect(server.broadcasts).toContain(campaignId);
    expect(server.campaigns.get(campaignId)?.state.characters[alexId]).toBeDefined();
  });

  it('refuses to link someone else’s character, or into a campaign I am not a player in', async () => {
    const created = await create(alex);
    const campaignId = campaignWithAlex('Ajena');
    expect((await call(sam, 'POST', `/characters/${created.id}/link`, { campaignId })).status).toBe(404);

    const notMine = server.campaigns.createCampaign(gmId, 'gm', 'Sin Alex').id;
    expect((await call(alex, 'POST', `/characters/${created.id}/link`, { campaignId: notMine })).status).toBe(403);
    expect((await call(alex, 'POST', `/characters/${created.id}/link`, { campaignId: '' })).status).toBe(400);
  });

  it('keeps one campaign per character and one character of mine per campaign', async () => {
    const first = await create(alex);
    const second = await create(alex);
    const a = campaignWithAlex('A');
    const b = campaignWithAlex('B');

    expect((await call(alex, 'POST', `/characters/${first.id}/link`, { campaignId: a })).status).toBe(200);
    const twice = await call(alex, 'POST', `/characters/${first.id}/link`, { campaignId: b });
    expect(twice.status).toBe(409);
    expect(await twice.json()).toEqual({ error: 'alreadyLinked' });

    const crowded = await call(alex, 'POST', `/characters/${second.id}/link`, { campaignId: a });
    expect(crowded.status).toBe(409);
    expect(await crowded.json()).toEqual({ error: 'campaignHasCharacter' });
  });

  it('unlinks with the room’s live sheet written back, and the list reads through while linked', async () => {
    const created = await create(alex);
    const campaignId = campaignWithAlex('Viva');
    await call(alex, 'POST', `/characters/${created.id}/link`, { campaignId });

    server.campaigns.seatFor(campaignId, alexId, 'alex');
    server.campaigns.apply(campaignId, { id: alexId, role: 'player' }, { type: 'markStress', characterId: alexId, amount: 2 });

    const listed = LibraryListSchema.parse(await (await call(alex, 'GET', '/characters')).json());
    expect(listed.find((c) => c.id === created.id)?.sheet.stressMarked).toBe(2);

    const unlinked = await call(alex, 'POST', `/characters/${created.id}/unlink`);
    expect(unlinked.status).toBe(200);
    expect(LibraryCharacterSchema.parse(await unlinked.json())).toMatchObject({ campaignId: null });
    expect(server.characters.get(created.id)?.sheet.stressMarked).toBe(2);
    expect(server.campaigns.get(campaignId)?.state.characters[alexId]).toBeUndefined();
  });

  it('brings a removed member’s character home', async () => {
    const created = await create(alex);
    const campaignId = campaignWithAlex('Expulsión');
    await call(alex, 'POST', `/characters/${created.id}/link`, { campaignId });

    expect((await call(gm, 'DELETE', `/campaigns/${campaignId}/players/${alexId}`)).status).toBe(204);
    expect(server.characters.get(created.id)?.campaignId).toBeNull();
  });
});
