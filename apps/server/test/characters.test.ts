import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CampaignStore } from '../src/campaigns.js';
import { CharacterStore } from '../src/characters.js';
import { readCharactersSnapshot, writeCharactersSnapshot } from '../src/characters-snapshot.js';
import {
  adoptRoomCharacters,
  detachMember,
  linkCharacter,
  listLibrary,
  serializeLibrary,
  unlinkCharacter,
} from '../src/library.js';
import { buildSheet } from './helpers.js';

function table() {
  const campaigns = new CampaignStore();
  const characters = new CharacterStore();
  const campaign = campaigns.createCampaign('u-gm', 'gm', 'Martes');
  campaigns.addMember(campaign.id, 'u-gm', 'u-alex');
  return { campaigns, characters, campaignId: campaign.id };
}

describe('CharacterStore', () => {
  it('keeps any number of characters per owner, each unlinked to start', () => {
    const { characters } = table();
    characters.create('u-alex', buildSheet());
    characters.create('u-alex', buildSheet('ranger'));
    characters.create('u-sam', buildSheet());
    expect(characters.listFor('u-alex')).toHaveLength(2);
    expect(characters.listFor('u-alex').every((c) => c.campaignId === null)).toBe(true);
  });
});

describe('linking', () => {
  it('seats the sheet in the room, with the Fear a new PC brings', () => {
    const { campaigns, characters, campaignId } = table();
    const entry = characters.create('u-alex', buildSheet());
    const fearBefore = campaigns.get(campaignId)?.state.fear ?? 0;

    const result = linkCharacter(characters, campaigns, 'u-alex', entry.id, campaignId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome.patch.characters?.['u-alex']).toBeDefined();
    expect(characters.get(entry.id)?.campaignId).toBe(campaignId);
    expect(campaigns.get(campaignId)?.state.characters['u-alex']).toEqual(entry.sheet);
    expect(campaigns.get(campaignId)?.state.fear).toBe(fearBefore + 1);
  });

  it('refuses someone else’s character', () => {
    const { campaigns, characters, campaignId } = table();
    const entry = characters.create('u-sam', buildSheet());
    expect(linkCharacter(characters, campaigns, 'u-alex', entry.id, campaignId)).toEqual({
      ok: false,
      status: 404,
      error: 'unknownCharacter',
    });
  });

  it('refuses a campaign the owner is not a player in', () => {
    const { campaigns, characters } = table();
    const other = campaigns.createCampaign('u-gm', 'gm', 'Jueves');
    campaigns.invite(other.id, 'u-gm', 'u-alex');
    const entry = characters.create('u-alex', buildSheet());
    expect(linkCharacter(characters, campaigns, 'u-alex', entry.id, other.id)).toMatchObject({
      ok: false,
      status: 403,
    });
    // The GM of a campaign has no character slot in it either.
    const mine = characters.create('u-gm', buildSheet());
    expect(linkCharacter(characters, campaigns, 'u-gm', mine.id, other.id)).toMatchObject({ status: 403 });
  });

  it('links a character to one campaign at a time', () => {
    const { campaigns, characters, campaignId } = table();
    const other = campaigns.createCampaign('u-gm', 'gm', 'Jueves');
    campaigns.addMember(other.id, 'u-gm', 'u-alex');
    const entry = characters.create('u-alex', buildSheet());
    linkCharacter(characters, campaigns, 'u-alex', entry.id, campaignId);

    expect(linkCharacter(characters, campaigns, 'u-alex', entry.id, other.id)).toEqual({
      ok: false,
      status: 409,
      error: 'alreadyLinked',
    });
  });

  it('allows one character of mine per campaign', () => {
    const { campaigns, characters, campaignId } = table();
    const first = characters.create('u-alex', buildSheet());
    const second = characters.create('u-alex', buildSheet('ranger'));
    linkCharacter(characters, campaigns, 'u-alex', first.id, campaignId);

    expect(linkCharacter(characters, campaigns, 'u-alex', second.id, campaignId)).toEqual({
      ok: false,
      status: 409,
      error: 'campaignHasCharacter',
    });
    expect(campaigns.get(campaignId)?.state.characters['u-alex']).toEqual(first.sheet);
  });
});

describe('reading and unlinking', () => {
  it('lists a linked character with the room’s live sheet and the campaign name', () => {
    const { campaigns, characters, campaignId } = table();
    campaigns.seatFor(campaignId, 'u-alex', 'alex');
    const entry = characters.create('u-alex', buildSheet());
    linkCharacter(characters, campaigns, 'u-alex', entry.id, campaignId);
    const marked = campaigns.apply(
      campaignId,
      { id: 'u-alex', role: 'player' },
      { type: 'markHP', characterId: 'u-alex', amount: 2 },
    );
    expect(marked.ok).toBe(true);
    const live = campaigns.get(campaignId)?.state.characters['u-alex'];
    expect(live?.hpMarked).toBe(2);

    const [listed] = listLibrary(characters, campaigns, 'u-alex');
    expect(listed?.campaignName).toBe('Martes');
    expect(listed?.sheet).toEqual(live);
  });

  it('writes the room’s sheet back on unlink and frees the campaign', () => {
    const { campaigns, characters, campaignId } = table();
    const entry = characters.create('u-alex', buildSheet());
    linkCharacter(characters, campaigns, 'u-alex', entry.id, campaignId);
    const room = campaigns.get(campaignId);
    if (room === null) throw new Error('no campaign');
    const changed = { ...entry.sheet, hope: 0 };
    room.state = { ...room.state, characters: { ...room.state.characters, 'u-alex': changed } };

    const result = unlinkCharacter(characters, campaigns, 'u-alex', entry.id);
    expect(result.ok).toBe(true);
    expect(characters.get(entry.id)).toMatchObject({ campaignId: null, sheet: changed });
    expect(campaigns.get(campaignId)?.state.characters['u-alex']).toBeUndefined();

    const second = characters.create('u-alex', buildSheet('ranger'));
    expect(linkCharacter(characters, campaigns, 'u-alex', second.id, campaignId).ok).toBe(true);
  });

  it('writes back and unlinks when the member is removed from the campaign', () => {
    const { campaigns, characters, campaignId } = table();
    const entry = characters.create('u-alex', buildSheet());
    linkCharacter(characters, campaigns, 'u-alex', entry.id, campaignId);
    const room = campaigns.get(campaignId);
    if (room === null) throw new Error('no campaign');
    const changed = { ...entry.sheet, hope: 0 };
    room.state = { ...room.state, characters: { ...room.state.characters, 'u-alex': changed } };

    detachMember(characters, campaigns, campaignId, 'u-alex');
    expect(characters.get(entry.id)).toMatchObject({ campaignId: null, sheet: changed });
  });

  it('snapshots linked characters with their live sheet', () => {
    const { campaigns, characters, campaignId } = table();
    const entry = characters.create('u-alex', buildSheet());
    linkCharacter(characters, campaigns, 'u-alex', entry.id, campaignId);
    const room = campaigns.get(campaignId);
    if (room === null) throw new Error('no campaign');
    room.state = {
      ...room.state,
      characters: { ...room.state.characters, 'u-alex': { ...entry.sheet, hope: 0 } },
    };
    expect(serializeLibrary(characters, campaigns)[0]?.sheet.hope).toBe(0);
  });
});

describe('boot migration', () => {
  it('adopts each player character already in a room, once', () => {
    const { campaigns, characters, campaignId } = table();
    campaigns.claimCharacter(campaignId, 'u-alex', buildSheet());

    expect(adoptRoomCharacters(characters, campaigns)).toBe(1);
    expect(adoptRoomCharacters(characters, campaigns)).toBe(0);
    const entries = characters.listFor('u-alex');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.campaignId).toBe(campaignId);
  });

  it('unlinks an entry whose room character is gone, keeping its last sheet', () => {
    const { campaigns, characters, campaignId } = table();
    const entry = characters.create('u-alex', buildSheet());
    characters.update(entry.id, { campaignId });

    adoptRoomCharacters(characters, campaigns);
    expect(characters.get(entry.id)).toMatchObject({ campaignId: null, sheet: entry.sheet });
  });
});

describe('characters snapshot', () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dh-characters-'));
  });
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('round-trips the library', async () => {
    const characters = new CharacterStore();
    characters.create('u-alex', buildSheet());
    const path = join(directory, 'characters.json');
    await writeCharactersSnapshot(path, characters.serialize());

    const restored = new CharacterStore();
    restored.restore(await readCharactersSnapshot(path));
    expect(restored.listFor('u-alex')).toEqual(characters.listFor('u-alex'));
  });

  it('drops one unreadable entry, not the whole file, and tolerates a missing file', async () => {
    const path = join(directory, 'mixed.json');
    const good = new CharacterStore().create('u-alex', buildSheet());
    await writeFile(
      path,
      JSON.stringify({ version: 1, characters: [good, { id: 'bad', sheet: 'nope' }] }),
      'utf8',
    );
    expect((await readCharactersSnapshot(path)).map((c) => c.id)).toEqual([good.id]);
    expect(await readCharactersSnapshot(join(directory, 'missing.json'))).toEqual([]);
  });
});
