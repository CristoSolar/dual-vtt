import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CampaignStore } from '../src/campaigns.js';
import { readCampaignsSnapshot, writeCampaignsSnapshot } from '../src/campaigns-snapshot.js';

describe('CampaignStore', () => {
  it('creates a campaign owned by its creator, with no members yet', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    expect(campaign.ownerId).toBe('u-gm');
    expect(campaign.memberIds).toEqual([]);
    expect(campaign.state.gm.id).toBe('u-gm');
    expect(store.roleOf(campaign.id, 'u-gm')).toBe('gm');
  });

  it('only the owner can add or remove a member', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');

    expect(store.addMember(campaign.id, 'u-someone-else', 'u-player')).toBe(false);
    expect(store.addMember(campaign.id, 'u-gm', 'u-player')).toBe(true);
    expect(store.roleOf(campaign.id, 'u-player')).toBe('player');

    expect(store.removeMember(campaign.id, 'u-someone-else', 'u-player')).toBe(false);
    expect(store.roleOf(campaign.id, 'u-player')).toBe('player');
    expect(store.removeMember(campaign.id, 'u-gm', 'u-player')).toBe(true);
    expect(store.roleOf(campaign.id, 'u-player')).toBeNull();
  });

  it('strips a removed member from the live room, not just from memberIds', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    store.addMember(campaign.id, 'u-gm', 'u-player');
    store.addMember(campaign.id, 'u-gm', 'u-other');
    store.seatFor(campaign.id, 'u-player', 'alex');
    store.seatFor(campaign.id, 'u-other', 'sam');
    store.claimCharacter(campaign.id, 'u-player', { fake: 'sheet' } as never);
    store.claimCharacter(campaign.id, 'u-other', { fake: 'other' } as never);

    expect(store.removeMember(campaign.id, 'u-gm', 'u-player')).toBe(true);
    const state = store.get(campaign.id)?.state;
    expect(state?.players.map((p) => p.id)).toEqual(['u-other']);
    expect(Object.keys(state?.characters ?? {})).toEqual(['u-other']);
  });

  it('lists campaigns an account owns or belongs to, and none it does not', () => {
    const store = new CampaignStore();
    const owned = store.createCampaign('u-gm', 'gm', 'Owned');
    const memberOf = store.createCampaign('u-other-gm', 'other-gm', 'Member of');
    store.addMember(memberOf.id, 'u-other-gm', 'u-gm');
    store.createCampaign('u-third-gm', 'third-gm', 'Unrelated');

    const listed = store.listFor('u-gm').map((c) => c.name).sort();
    expect(listed).toEqual(['Member of', 'Owned']);
  });

  it('seats an account live and adds it to the roster the first time', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    store.addMember(campaign.id, 'u-gm', 'u-player');

    const seat = store.seatFor(campaign.id, 'u-player', 'alex');
    expect(seat?.role).toBe('player');
    expect(store.get(campaign.id)?.state.players).toEqual([
      { id: 'u-player', name: 'alex', connected: true, characterId: null },
    ]);

    expect(store.seatFor(campaign.id, 'u-stranger', 'nobody')).toBeNull();
  });

  it('claims a character keyed by the claiming account id', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    store.addMember(campaign.id, 'u-gm', 'u-player');
    store.seatFor(campaign.id, 'u-player', 'alex');

    const sheet = { fake: 'sheet' } as never;
    const outcome = store.claimCharacter(campaign.id, 'u-player', sheet);
    expect(outcome.ok).toBe(true);
    expect(store.get(campaign.id)?.state.characters['u-player']).toBe(sheet);
    expect(store.get(campaign.id)?.state.players[0]?.characterId).toBe('u-player');
  });

  it('round-trips through serialize/restore', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    store.addMember(campaign.id, 'u-gm', 'u-player');

    const restored = new CampaignStore();
    restored.restore(store.serialize());

    expect(restored.get(campaign.id)?.name).toBe('Grupo Martes');
    expect(restored.roleOf(campaign.id, 'u-player')).toBe('player');
  });
});

describe('campaigns snapshot file', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dh-campaigns-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads back exactly what it wrote', async () => {
    const store = new CampaignStore();
    store.createCampaign('u-gm', 'gm', 'Grupo Martes');
    const path = join(directory, 'campaigns.json');

    await writeCampaignsSnapshot(path, store.serialize());
    const restored = await readCampaignsSnapshot(path);

    const fresh = new CampaignStore();
    fresh.restore(restored);
    expect(fresh.listFor('u-gm')).toHaveLength(1);
  });

  it('returns an empty array when the file does not exist', async () => {
    expect(await readCampaignsSnapshot(join(directory, 'missing.json'))).toEqual([]);
  });

  it('discards unreadable JSON instead of throwing', async () => {
    const path = join(directory, 'corrupt.json');
    await writeCampaignsSnapshot(path, []);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'not json', 'utf8');
    expect(await readCampaignsSnapshot(path)).toEqual([]);
  });
});
