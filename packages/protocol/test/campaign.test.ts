import { describe, expect, it } from 'vitest';

import {
  AddPlayerRequestSchema,
  CampaignSummarySchema,
  CreateCampaignRequestSchema,
} from '../src/index.js';

describe('campaign schemas', () => {
  it('accepts a well-formed campaign summary', () => {
    const summary = {
      id: 'c-1',
      name: 'Grupo Martes',
      ownerId: 'u-1',
      ownerUsername: 'gm',
      memberIds: ['u-2', 'u-3'],
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
