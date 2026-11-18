import { describe, expect, it } from 'vitest';

import {
  CampaignListSchema,
  CampaignSummarySchema,
  claimCharacterInRoom,
  CreateCharacterRequestSchema,
  createRoomState,
  createSheet,
  InvitePlayerRequestSchema,
  LibraryCharacterSchema,
  LinkCharacterRequestSchema,
  releaseCharacterInRoom,
  type RoomState,
} from '../src/index.js';

import { makeCharacter } from './helpers.js';

const sheet = () => createSheet(makeCharacter());

describe('character library schemas', () => {
  it('accepts an unlinked and a linked library entry', () => {
    const base = { id: 'ch-1', ownerId: 'u-1', sheet: sheet(), updatedAt: 1 };
    expect(LibraryCharacterSchema.safeParse({ ...base, campaignId: null, campaignName: null }).success).toBe(true);
    expect(
      LibraryCharacterSchema.safeParse({ ...base, campaignId: 'c-1', campaignName: 'Martes' }).success,
    ).toBe(true);
  });

  it('rejects an entry whose sheet is not a sheet', () => {
    expect(
      LibraryCharacterSchema.safeParse({
        id: 'ch-1',
        ownerId: 'u-1',
        sheet: { name: 'nope' },
        campaignId: null,
        campaignName: null,
        updatedAt: 1,
      }).success,
    ).toBe(false);
  });

  it('validates create and link request bodies', () => {
    expect(CreateCharacterRequestSchema.safeParse({ sheet: sheet() }).success).toBe(true);
    expect(CreateCharacterRequestSchema.safeParse({}).success).toBe(false);
    expect(LinkCharacterRequestSchema.safeParse({ campaignId: 'c-1' }).success).toBe(true);
    expect(LinkCharacterRequestSchema.safeParse({ campaignId: '' }).success).toBe(false);
  });
});

describe('invitation schemas', () => {
  it('reads a summary without invitedIds as having none', () => {
    const parsed = CampaignSummarySchema.parse({
      id: 'c-1',
      name: 'Martes',
      ownerId: 'u-1',
      ownerUsername: 'gm',
      memberIds: [],
    });
    expect(parsed.invitedIds).toEqual([]);
  });

  it('splits the campaign list into member and invited', () => {
    const summary = { id: 'c-1', name: 'Martes', ownerId: 'u-1', ownerUsername: 'gm', memberIds: [], invitedIds: [] };
    expect(CampaignListSchema.safeParse({ member: [summary], invited: [] }).success).toBe(true);
    expect(CampaignListSchema.safeParse([summary]).success).toBe(false);
  });

  it('needs a username to invite', () => {
    expect(InvitePlayerRequestSchema.safeParse({ username: 'alex' }).success).toBe(true);
    expect(InvitePlayerRequestSchema.safeParse({ username: '' }).success).toBe(false);
  });
});

describe('releaseCharacterInRoom', () => {
  const room = (): RoomState => {
    const base = createRoomState('c-1', { id: 'gm', name: 'GM', connected: true });
    return claimCharacterInRoom(
      { ...base, players: [{ id: 'alex', name: 'Alex', connected: true, characterId: null }] },
      'alex',
      sheet(),
    );
  };

  it('takes the character out of the room and clears the seat', () => {
    const released = releaseCharacterInRoom(room(), 'alex');
    expect(released.characters.alex).toBeUndefined();
    expect(released.players[0]?.characterId).toBeNull();
    expect(released.players[0]?.id).toBe('alex');
  });

  it('leaves the room alone when the account has no character there', () => {
    const before = room();
    expect(releaseCharacterInRoom(before, 'sam')).toBe(before);
  });
});
