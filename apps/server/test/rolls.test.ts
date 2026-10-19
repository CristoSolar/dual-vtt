import { createSheet, makeDualityRoll } from '@daggerheart/protocol';
import { resolveActionRoll, rollDuality, seededRng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import { CampaignStore, rngForRoll } from '../src/campaigns.js';
import { buildCharacter, buildSheet } from './helpers.js';

describe('server-side dice', () => {
  it('produces the identical result to the same call in the rules package', () => {
    const seed = 987;
    const request = {
      label: 'Agility Roll',
      modifiers: 3,
      difficulty: 12,
      advantage: 1,
      disadvantage: 0,
      experiences: [],
    };

    const expected = rollDuality({
      modifiers: request.modifiers,
      advantage: request.advantage,
      disadvantage: request.disadvantage,
      rng: seededRng(seed),
    });
    const expectedOutcome = resolveActionRoll(expected, request.difficulty);

    const sheet = createSheet(buildCharacter('ranger'));
    const actual = makeDualityRoll(sheet, request, rngForRoll(seed, 0));

    expect(actual.outcome).not.toBeNull();
    expect(actual.outcome?.roll).toEqual(expected);
    expect(actual.outcome?.result.outcome).toBe(expectedOutcome.outcome);
  });

  it('is reproducible: the same (seed, index) always rolls the same dice', () => {
    const first = rollDuality({ rng: rngForRoll(42, 7) });
    const second = rollDuality({ rng: rngForRoll(42, 7) });
    expect(first).toEqual(second);
  });

  it('advances the dice between rolls so a campaign does not repeat itself', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Dice Test', 555);
    store.addMember(campaign.id, 'u-gm', 'u-player');
    store.seatFor(campaign.id, 'u-player', 'player');
    store.claimCharacter(campaign.id, 'u-player', buildSheet('ranger'));

    const roll = () => {
      const outcome = store.apply(campaign.id, { id: 'u-player', role: 'player' }, {
        type: 'rollDuality',
        characterId: 'u-player',
        visibility: 'public',
        request: { label: 'Roll', modifiers: 0, difficulty: 10, advantage: 0, disadvantage: 0, helpDice: 0, reaction: false, experiences: [] },
      });
      const entry = outcome.entries[0];
      if (entry === undefined || entry.kind !== 'duality') throw new Error('no roll');
      return entry.roll;
    };

    const rolls = [roll(), roll(), roll()];
    expect(store.get(campaign.id)?.rollCount).toBe(3);
    expect(new Set(rolls.map((r) => `${r.hope}-${r.fear}`)).size).toBeGreaterThan(1);
  });

  it('advances the roll index for every event that rolls dice, even without a logged entry', () => {
    // rollFate carries no character and produces an entry, but the index must
    // still move so the next roll of any kind does not repeat it.
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Fate Test', 111);

    const roll = () =>
      store.apply(campaign.id, { id: 'u-gm', role: 'gm' }, {
        type: 'rollFate',
        kind: 'fate',
        visibility: 'public',
        label: 'Fate',
      });

    const a = roll();
    const b = roll();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(store.get(campaign.id)?.rollCount).toBe(2);
  });

  it('advances the roll index for beginRest, which rolls Fear but logs no entry', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Rest Test', 222);

    const outcome = store.apply(campaign.id, { id: 'u-gm', role: 'gm' }, {
      type: 'beginRest',
      kind: 'short',
    });

    expect(outcome.ok).toBe(true);
    expect(store.get(campaign.id)?.rollCount).toBe(1);
  });

  it('advances the roll index for rollTable', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Table Test', 444);
    store.apply(campaign.id, { id: 'u-gm', role: 'gm' }, {
      type: 'upsertTable',
      table: { id: 't-1', name: 'Encounters', rows: ['Wolves', 'Bandits', 'Nothing'] },
    });

    const outcome = store.apply(campaign.id, { id: 'u-gm', role: 'gm' }, {
      type: 'rollTable',
      tableId: 't-1',
      visibility: 'public',
    });

    expect(outcome.ok).toBe(true);
    expect(store.get(campaign.id)?.rollCount).toBe(1);
  });

  it('leaves the roll index unchanged for an event that never touches the rng', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'No Roll Test', 333);

    const outcome = store.apply(campaign.id, { id: 'u-gm', role: 'gm' }, {
      type: 'gainFear',
      amount: 1,
    });

    expect(outcome.ok).toBe(true);
    expect(store.get(campaign.id)?.rollCount).toBe(0);
  });

  it('replays a logged roll from its seed and index for auditing', () => {
    const store = new CampaignStore();
    const campaign = store.createCampaign('u-gm', 'gm', 'Audit Test', 2024);
    store.addMember(campaign.id, 'u-gm', 'u-player');
    store.seatFor(campaign.id, 'u-player', 'player');
    store.claimCharacter(campaign.id, 'u-player', buildSheet());

    const outcome = store.apply(campaign.id, { id: 'u-player', role: 'player' }, {
      type: 'rollDuality',
      characterId: 'u-player',
      visibility: 'public',
      request: { label: 'Audit', modifiers: 0, difficulty: 10, advantage: 0, disadvantage: 0, helpDice: 0, reaction: false, experiences: [] },
    });

    const entry = outcome.entries[0];
    if (entry === undefined || entry.kind !== 'duality') throw new Error('no roll');
    expect(rollDuality({ rng: rngForRoll(2024, 0) })).toEqual(entry.roll);
  });
});

describe('campaign ids', () => {
  it('never issues the same id to two live campaigns', () => {
    const store = new CampaignStore();
    const ids = new Set<string>();
    for (let i = 0; i < 30; i++) ids.add(store.createCampaign(`u-gm-${i}`, `gm-${i}`, `Campaign ${i}`).id);
    expect(ids.size).toBe(30);
  });
});
