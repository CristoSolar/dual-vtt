import {
  CampaignDetailSchema,
  CampaignListSchema,
  CHANNEL,
  ManagedPlayerSchema,
  type RejectedMessage,
  type RoomPatch,
  type RoomState,
} from '@daggerheart/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CampaignStore } from '../src/campaigns.js';
import { UserStore } from '../src/users.js';
import {
  accountFor,
  buildSheet,
  startTestServer,
  TestClient,
  type AccountFixture,
  type TestServer,
} from './helpers.js';

/**
 * The GM's side of the home redesign: campaign status (and what it does to a
 * player's seat), the campaign page's detail and prep routes, and "Mis jugadores".
 */

let server: TestServer;
let gm: AccountFixture;
let ana: AccountFixture;
let campaignId: string;

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${server.url}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

/** Seats `account` in the campaign and resolves with the state it is sent. */
async function seat(account: AccountFixture): Promise<{ client: TestClient; state: RoomState }> {
  const client = await TestClient.connect(server.url, account.token);
  const state = client.next<RoomState>(CHANNEL.roomState);
  client.emit(CHANNEL.joinCampaign, { campaignId });
  return { client, state: await state };
}

beforeEach(async () => {
  server = await startTestServer();
  gm = await accountFor(server, 'gm', 'gm');
  ana = await accountFor(server, 'ana');
  campaignId = server.campaigns.createCampaign(gm.id, gm.username, 'Martes').id;
  server.campaigns.addMember(campaignId, gm.id, ana.id);
});

afterEach(async () => {
  await server.close();
});

describe('campaign status in the store', () => {
  it('a new campaign is active', () => {
    expect(server.campaigns.get(campaignId)?.status).toBe('active');
  });

  it('only the owner changes it', () => {
    expect(server.campaigns.setStatus(campaignId, ana.id, 'paused')).toBe(false);
    expect(server.campaigns.setStatus(campaignId, gm.id, 'paused')).toBe(true);
    expect(server.campaigns.get(campaignId)?.status).toBe('paused');
  });

  it('a paused or finished campaign admits its GM and no player', () => {
    server.campaigns.setStatus(campaignId, gm.id, 'finished');
    expect(server.campaigns.mayEnter(campaignId, gm.id)).toBe('gm');
    expect(server.campaigns.mayEnter(campaignId, ana.id)).toBe('notActive');
    expect(server.campaigns.mayEnter(campaignId, 'stranger')).toBe('notMember');
  });

  it('round-trips through serialize/restore, and an old record without it is active', () => {
    server.campaigns.setStatus(campaignId, gm.id, 'paused');
    const [record] = server.campaigns.serialize();
    if (record === undefined) throw new Error('no record');
    const restored = new CampaignStore();
    restored.restore([record, { ...record, id: 'c-old', status: undefined }]);
    expect(restored.get(campaignId)?.status).toBe('paused');
    expect(restored.get('c-old')?.status).toBe('active');
  });
});

describe('status at the table', () => {
  it('a player cannot sit at a paused campaign; the GM can', async () => {
    server.campaigns.setStatus(campaignId, gm.id, 'paused');
    const client = await TestClient.connect(server.url, ana.token);
    const rejected = client.next<RejectedMessage>(CHANNEL.rejected);
    client.emit(CHANNEL.joinCampaign, { campaignId });
    expect((await rejected).error).toBe('campaignNotActive');
    client.close();

    const gmSeat = await seat(gm);
    expect(gmSeat.state.id).toBe(campaignId);
    gmSeat.client.close();
  });

  it('pausing over HTTP cuts a seated player off at once', async () => {
    const player = await seat(ana);
    const rejected = player.client.next<RejectedMessage>(CHANNEL.rejected);
    const response = await call('PATCH', `/campaigns/${campaignId}`, gm.token, { status: 'paused' });
    expect(response.status).toBe(200);
    expect((await rejected).error).toBe('campaignNotActive');

    // The seat is gone: the next intent is refused rather than applied.
    const again = player.client.next<RejectedMessage>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, { type: 'sendMessage', text: 'hola', whisperTo: [] });
    expect((await again).error).toBe('noSeat');
    player.client.close();
  });

  it('the per-message check refuses a player whose campaign stopped being active', async () => {
    const player = await seat(ana);
    // Straight on the store, so no eviction runs: only the per-message check is left.
    server.campaigns.setStatus(campaignId, gm.id, 'finished');
    const rejected = player.client.next<RejectedMessage>(CHANNEL.rejected);
    player.client.emit(CHANNEL.intent, { type: 'sendMessage', text: 'hola', whisperTo: [] });
    expect((await rejected).error).toBe('campaignNotActive');
    player.client.close();
  });

  it('a GM stays seated through a pause', async () => {
    const gmSeat = await seat(gm);
    await call('PATCH', `/campaigns/${campaignId}`, gm.token, { status: 'paused' });
    const patch = gmSeat.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.fear !== undefined);
    gmSeat.client.emit(CHANNEL.intent, { type: 'gainFear', amount: 1 });
    expect((await patch).fear).toBe(1);
    gmSeat.client.close();
  });
});

describe('PATCH /campaigns/:id', () => {
  it('needs a login', async () => {
    expect((await call('PATCH', `/campaigns/${campaignId}`, null, { status: 'paused' })).status).toBe(401);
  });

  it('is the GM of that campaign only', async () => {
    const otherGm = await accountFor(server, 'gm2', 'gm');
    expect((await call('PATCH', `/campaigns/${campaignId}`, ana.token, { status: 'paused' })).status).toBe(403);
    expect((await call('PATCH', `/campaigns/${campaignId}`, otherGm.token, { name: 'Mine' })).status).toBe(403);
    expect((await call('PATCH', `/campaigns/c-missing`, gm.token, { name: 'X' })).status).toBe(403);
    expect(server.campaigns.get(campaignId)?.name).toBe('Martes');
  });

  it('refuses a bad body', async () => {
    expect((await call('PATCH', `/campaigns/${campaignId}`, gm.token, { status: 'archived' })).status).toBe(400);
    expect((await call('PATCH', `/campaigns/${campaignId}`, gm.token, {})).status).toBe(400);
    expect((await call('PATCH', `/campaigns/${campaignId}`, gm.token, 'not json')).status).toBe(400);
  });

  it('renames and changes status, and the list reports both', async () => {
    const response = await call('PATCH', `/campaigns/${campaignId}`, gm.token, { name: 'Jueves', status: 'finished' });
    expect(response.status).toBe(200);
    const list = CampaignListSchema.parse((await call('GET', '/campaigns', ana.token)).body);
    expect(list.member[0]).toMatchObject({ name: 'Jueves', status: 'finished' });
  });
});

describe('GET /campaigns/:id (the GM campaign page)', () => {
  it('needs a login, and is the GM of that campaign only', async () => {
    expect((await call('GET', `/campaigns/${campaignId}`, null)).status).toBe(401);
    expect((await call('GET', `/campaigns/${campaignId}`, ana.token)).status).toBe(403);
    const otherGm = await accountFor(server, 'gm2', 'gm');
    expect((await call('GET', `/campaigns/${campaignId}`, otherGm.token)).status).toBe(403);
  });

  it('lists members with their character, invitees by name, and the GM slices', async () => {
    const beto = await accountFor(server, 'beto');
    server.campaigns.invite(campaignId, gm.id, beto.id);
    const sheet = buildSheet('guardian');
    await server.link(campaignId, ana.id, sheet);
    server.campaigns.apply(campaignId, { id: gm.id, role: 'gm' }, {
      type: 'setStory',
      story: { pitch: 'Un robo.', body: 'Sesión 1.' },
    });

    const response = await call('GET', `/campaigns/${campaignId}`, gm.token);
    expect(response.status).toBe(200);
    const detail = CampaignDetailSchema.parse(response.body);
    expect(detail.campaign.status).toBe('active');
    expect(detail.members).toEqual([
      { id: ana.id, username: 'ana', character: { name: sheet.character.name, classId: 'guardian', level: 1 } },
    ]);
    expect(detail.invited).toEqual([{ id: beto.id, username: 'beto' }]);
    expect(detail.story.pitch).toBe('Un robo.');
    // The detail is not a room: nothing else of the state rides along.
    expect(response.body).not.toHaveProperty('characters');
    expect(response.body).not.toHaveProperty('state');
  });
});

describe('POST /campaigns/:id/prep', () => {
  const addBurrower = { type: 'upsertPrepAdversary', entry: { id: 'p-1', adversaryId: 'acid-burrower', quantity: 2, note: '' } };

  it('needs a login, and is the GM of that campaign only', async () => {
    expect((await call('POST', `/campaigns/${campaignId}/prep`, null, addBurrower)).status).toBe(401);
    expect((await call('POST', `/campaigns/${campaignId}/prep`, ana.token, addBurrower)).status).toBe(403);
    const otherGm = await accountFor(server, 'gm2', 'gm');
    expect((await call('POST', `/campaigns/${campaignId}/prep`, otherGm.token, addBurrower)).status).toBe(403);
    expect(server.campaigns.get(campaignId)?.state.prepAdversaries).toEqual([]);
  });

  it('takes only prep intents', async () => {
    expect((await call('POST', `/campaigns/${campaignId}/prep`, gm.token, { type: 'gainFear', amount: 3 })).status).toBe(400);
    expect(server.campaigns.get(campaignId)?.state.fear).toBe(0);
  });

  it('a refusal from the reducer is a 409 with its code', async () => {
    const bad = { type: 'upsertPrepAdversary', entry: { id: 'p-1', adversaryId: 'nope', quantity: 1, note: '' } };
    const response = await call('POST', `/campaigns/${campaignId}/prep`, gm.token, bad);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'unknownAdversary' });
  });

  it('applies, answers with the detail, and reaches a seated GM but not a seated player', async () => {
    const gmSeat = await seat(gm);
    const player = await seat(ana);
    const gmPatch = gmSeat.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.prepAdversaries !== undefined);
    let playerSawPrep = false;
    player.client.socket.on(CHANNEL.roomPatch, (p: RoomPatch) => {
      if (p.prepAdversaries !== undefined || p.story !== undefined) playerSawPrep = true;
    });

    const response = await call('POST', `/campaigns/${campaignId}/prep`, gm.token, addBurrower);
    expect(response.status).toBe(200);
    expect(CampaignDetailSchema.parse(response.body).prepAdversaries.map((p) => p.id)).toEqual(['p-1']);
    expect((await gmPatch).prepAdversaries?.[0]?.quantity).toBe(2);

    await call('POST', `/campaigns/${campaignId}/prep`, gm.token, { type: 'setStory', story: { pitch: 'x', body: 'y' } });
    // A round trip the player does see, so anything sent before it has arrived.
    const fear = player.client.until<RoomPatch>(CHANNEL.roomPatch, (p) => p.fear !== undefined);
    gmSeat.client.emit(CHANNEL.intent, { type: 'gainFear', amount: 1 });
    await fear;
    expect(playerSawPrep).toBe(false);
    gmSeat.client.close();
    player.client.close();
  });

  it('works on a paused campaign: the GM prepares between sessions', async () => {
    server.campaigns.setStatus(campaignId, gm.id, 'paused');
    expect((await call('POST', `/campaigns/${campaignId}/prep`, gm.token, addBurrower)).status).toBe(200);
  });
});

describe('Mis jugadores', () => {
  it('a player the GM creates over HTTP is theirs', async () => {
    const response = await call('POST', '/users', gm.token, { username: 'carla', password: 'password1' });
    expect(response.status).toBe(201);
    const carla = server.users.findByUsername('carla');
    expect(carla?.createdBy).toBe(gm.id);
  });

  it('GET /players needs a GM login', async () => {
    expect((await call('GET', '/players', null)).status).toBe(401);
    expect((await call('GET', '/players', ana.token)).status).toBe(403);
  });

  it("lists the GM's own players and legacy ones, never another GM's", async () => {
    const otherGm = await accountFor(server, 'gm2', 'gm');
    await call('POST', '/users', gm.token, { username: 'carla', password: 'password1' });
    await call('POST', '/users', otherGm.token, { username: 'dario', password: 'password1' });

    const mine = z.array(ManagedPlayerSchema).parse((await call('GET', '/players', gm.token)).body);
    // `ana` predates `createdBy` (the fixture leaves it null): every GM manages her.
    expect(mine.map((p) => p.username).sort()).toEqual(['ana', 'carla']);
    const theirs = z.array(ManagedPlayerSchema).parse((await call('GET', '/players', otherGm.token)).body);
    expect(theirs.map((p) => p.username).sort()).toEqual(['ana', 'dario']);

    // GET /users is scoped the same way.
    const users = (await call('GET', '/users', gm.token)).body as { username: string }[];
    expect(users.map((u) => u.username).sort()).toEqual(['ana', 'carla']);
  });

  it("reports only the GM's own campaigns and invitations, and never a hash", async () => {
    const otherGm = await accountFor(server, 'gm2', 'gm');
    const theirs = server.campaigns.createCampaign(otherGm.id, 'gm2', 'Ajena');
    server.campaigns.addMember(theirs.id, otherGm.id, ana.id);
    const second = server.campaigns.createCampaign(gm.id, 'gm', 'Viernes');
    server.campaigns.invite(second.id, gm.id, ana.id);

    const response = await call('GET', '/players', gm.token);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    const row = z.array(ManagedPlayerSchema).parse(response.body).find((p) => p.username === 'ana');
    expect(row?.campaigns).toEqual([{ id: campaignId, name: 'Martes', status: 'active' }]);
    expect(row?.invitedTo).toEqual([{ id: second.id, name: 'Viernes' }]);
  });

  it('records the last login', async () => {
    await server.users.setPassword(ana.id, 'password1', false);
    const before = z.array(ManagedPlayerSchema).parse((await call('GET', '/players', gm.token)).body);
    expect(before.find((p) => p.id === ana.id)?.lastLoginAt).toBeNull();
    expect((await call('POST', '/login', null, { username: 'ana', password: 'password1' })).status).toBe(200);
    const after = z.array(ManagedPlayerSchema).parse((await call('GET', '/players', gm.token)).body);
    expect(after.find((p) => p.id === ana.id)?.lastLoginAt).toEqual(expect.any(Number));
  });

  it("a GM cannot reset another GM's player's password, nor a GM's", async () => {
    const otherGm = await accountFor(server, 'gm2', 'gm');
    await call('POST', '/users', otherGm.token, { username: 'dario', password: 'password1' });
    const dario = server.users.findByUsername('dario');
    if (dario === null) throw new Error('no dario');
    expect((await call('POST', `/users/${dario.id}/reset-password`, gm.token, { newPassword: 'hijacked1' })).status).toBe(404);
    expect((await call('POST', `/users/${otherGm.id}/reset-password`, gm.token, { newPassword: 'hijacked1' })).status).toBe(404);
    expect((await call('POST', `/users/${dario.id}/reset-password`, otherGm.token, { newPassword: 'newpass12' })).status).toBe(204);
  });

  it("a GM cannot invite another GM's player", async () => {
    const otherGm = await accountFor(server, 'gm2', 'gm');
    await call('POST', '/users', otherGm.token, { username: 'dario', password: 'password1' });
    const response = await call('POST', `/campaigns/${campaignId}/invites`, gm.token, { username: 'dario' });
    expect(response.status).toBe(404);
    expect(server.campaigns.get(campaignId)?.invitedIds).toEqual([]);
  });
});

describe('UserStore', () => {
  it('createdBy defaults to null and lastLoginAt starts null', async () => {
    const users = new UserStore();
    const legacy = await users.createUser('old', 'password', 'player');
    const owned = await users.createUser('new', 'password', 'player', 'gm-1');
    expect(users.findStored(legacy?.id ?? '')?.createdBy).toBeNull();
    expect(users.findStored(owned?.id ?? '')?.createdBy).toBe('gm-1');
    expect(users.findStored(owned?.id ?? '')?.lastLoginAt).toBeNull();
  });
});
