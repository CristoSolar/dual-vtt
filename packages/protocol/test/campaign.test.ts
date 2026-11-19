import { describe, expect, it } from 'vitest';

import {
  AddPlayerRequestSchema,
  CampaignDetailSchema,
  CampaignSummarySchema,
  CreateCampaignRequestSchema,
  ManagedPlayerSchema,
  UpdateCampaignRequestSchema,
} from '../src/index.js';

describe('campaign schemas', () => {
  it('accepts a well-formed campaign summary', () => {
    const summary = {
      id: 'c-1',
      name: 'Grupo Martes',
      ownerId: 'u-1',
      ownerUsername: 'gm',
      memberIds: ['u-2', 'u-3'],
      invitedIds: ['u-4'],
      status: 'paused' as const,
    };
    expect(CampaignSummarySchema.parse(summary)).toEqual(summary);
  });

  it('rejects a campaign summary with an empty name', () => {
    expect(
      CampaignSummarySchema.safeParse({
        id: 'c-1',
        name: '',
        ownerId: 'u-1',
        ownerUsername: 'gm',
        memberIds: [],
      }).success,
    ).toBe(false);
  });

  it('validates create-campaign and add-player payload shapes', () => {
    expect(CreateCampaignRequestSchema.safeParse({ name: 'Grupo Martes' }).success).toBe(true);
    expect(CreateCampaignRequestSchema.safeParse({ name: '' }).success).toBe(false);
    expect(AddPlayerRequestSchema.safeParse({ username: 'alex' }).success).toBe(true);
    expect(AddPlayerRequestSchema.safeParse({ username: '' }).success).toBe(false);
  });
});

describe('campaign status', () => {
  it('defaults to active, so a summary from an older server still reads', () => {
    const parsed = CampaignSummarySchema.parse({
      id: 'c-1',
      name: 'Martes',
      ownerId: 'u-1',
      ownerUsername: 'gm',
      memberIds: [],
    });
    expect(parsed.status).toBe('active');
  });

  it('accepts only the three statuses', () => {
    expect(UpdateCampaignRequestSchema.safeParse({ status: 'finished' }).success).toBe(true);
    expect(UpdateCampaignRequestSchema.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('an update renames, changes status, or both, but is never empty', () => {
    expect(UpdateCampaignRequestSchema.safeParse({ name: 'Jueves' }).success).toBe(true);
    expect(UpdateCampaignRequestSchema.safeParse({ name: 'Jueves', status: 'active' }).success).toBe(true);
    expect(UpdateCampaignRequestSchema.safeParse({}).success).toBe(false);
    expect(UpdateCampaignRequestSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('campaign detail (the GM campaign page)', () => {
  it('carries members with their character, invitees, story, prep and journal', () => {
    const detail = {
      campaign: {
        id: 'c-1',
        name: 'Martes',
        ownerId: 'u-1',
        ownerUsername: 'gm',
        memberIds: ['u-2'],
        invitedIds: ['u-3'],
        status: 'active',
      },
      members: [
        { id: 'u-2', username: 'ana', character: { name: 'Brunilda', classId: 'guardian', level: 1 } },
      ],
      invited: [{ id: 'u-3', username: 'beto' }],
      story: { pitch: 'p', body: 'b' },
      prepAdversaries: [{ id: 'p-1', adversaryId: 'acid-burrower', quantity: 2, note: '' }],
      journal: [],
    };
    expect(CampaignDetailSchema.parse(detail)).toEqual(detail);
  });

  it('a member without a character has null', () => {
    expect(
      CampaignDetailSchema.shape.members.element.safeParse({ id: 'u-2', username: 'ana', character: null }).success,
    ).toBe(true);
  });
});

describe('managed player (Mis jugadores row)', () => {
  it('never has a password hash, and drops one if sent', () => {
    const parsed = ManagedPlayerSchema.parse({
      id: 'u-2',
      username: 'ana',
      mustChangePassword: false,
      campaigns: [{ id: 'c-1', name: 'Martes', status: 'active' }],
      invitedTo: [],
      lastLoginAt: null,
      passwordHash: 'x',
    });
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});
