import type { AdversaryInstance, CampaignSummary, ManagedPlayer } from '@daggerheart/protocol';
import { srd } from '@daggerheart/srd-data';
import { describe, expect, it } from 'vitest';

import {
  campaignsByStatus,
  canEnter,
  createLatestGate,
  encounterEvents,
  filterAdversaries,
  invitableCampaigns,
  invitablePlayers,
  parseCampaignDetail,
  parseManagedPlayers,
  parseQuantityDraft,
} from '../src/state/gmHome.js';

const GM = 'u-gm';

const summary = (id: string, status: CampaignSummary['status'], ownerId = GM): CampaignSummary => ({
  id,
  name: `Campaign ${id}`,
  ownerId,
  ownerUsername: 'gm',
  memberIds: [],
  invitedIds: [],
  status,
});

const player = (id: string, username: string): ManagedPlayer => ({
  id,
  username,
  mustChangePassword: false,
  campaigns: [],
  invitedTo: [],
  lastLoginAt: null,
});

describe('campaignsByStatus', () => {
  it('groups the campaigns this GM runs, and leaves out ones they only play in', () => {
    const groups = campaignsByStatus(
      [summary('a', 'active'), summary('b', 'paused'), summary('c', 'finished'), summary('d', 'active', 'u-other')],
      GM,
    );
    expect(groups.active.map((c) => c.id)).toEqual(['a']);
    expect(groups.paused.map((c) => c.id)).toEqual(['b']);
    expect(groups.finished.map((c) => c.id)).toEqual(['c']);
  });
});

describe('canEnter', () => {
  it('a player enters only an active campaign; its GM enters any', () => {
    expect(canEnter(summary('a', 'active'), 'u-player')).toBe(true);
    expect(canEnter(summary('a', 'paused'), 'u-player')).toBe(false);
    expect(canEnter(summary('a', 'finished'), 'u-player')).toBe(false);
    expect(canEnter(summary('a', 'finished'), GM)).toBe(true);
  });
});

describe('parseCampaignDetail', () => {
  it('reads a well-formed detail and refuses anything else', () => {
    const detail = {
      campaign: summary('a', 'active'),
      members: [],
      invited: [],
      story: { pitch: '', body: '' },
      prepAdversaries: [],
      journal: [],
    };
    expect(parseCampaignDetail(detail)?.campaign.id).toBe('a');
    expect(parseCampaignDetail({ campaign: 'nope' })).toBeNull();
    expect(parseCampaignDetail(null)).toBeNull();
  });
});

describe('parseManagedPlayers', () => {
  it('keeps readable rows and drops the rest', () => {
    expect(parseManagedPlayers([player('u-1', 'ana'), { id: 'u-2' }]).map((p) => p.username)).toEqual(['ana']);
    expect(parseManagedPlayers('nope')).toEqual([]);
  });
});

describe('invitablePlayers', () => {
  it('leaves out members and pending invitees', () => {
    const players = [player('u-1', 'ana'), player('u-2', 'beto'), player('u-3', 'carla')];
    const campaign = { ...summary('a', 'active'), memberIds: ['u-1'], invitedIds: ['u-2'] };
    expect(invitablePlayers(players, campaign).map((p) => p.username)).toEqual(['carla']);
  });
});

describe('invitableCampaigns', () => {
  it("offers this GM's campaigns the player is neither in nor invited to", () => {
    const row = {
      ...player('u-1', 'ana'),
      campaigns: [{ id: 'a', name: 'A', status: 'active' as const }],
      invitedTo: [{ id: 'b', name: 'B' }],
    };
    const campaigns = [summary('a', 'active'), summary('b', 'active'), summary('c', 'paused'), summary('d', 'active', 'u-x')];
    expect(invitableCampaigns(row, campaigns, GM).map((c) => c.id)).toEqual(['c']);
  });
});

describe('filterAdversaries', () => {
  const all = srd().adversaries;

  it('with no filter, lists every adversary', () => {
    expect(filterAdversaries(all, { query: '', tier: null, type: null })).toHaveLength(all.length);
  });

  it('filters by name, tier and type together', () => {
    const first = all[0];
    if (first === undefined) throw new Error('no adversaries');
    const found = filterAdversaries(all, { query: first.name.slice(0, 4).toUpperCase(), tier: first.tier, type: first.type });
    expect(found.map((a) => a.id)).toContain(first.id);
    expect(found.every((a) => a.tier === first.tier && a.type === first.type)).toBe(true);
    expect(found.every((a) => a.name.toLowerCase().includes(first.name.slice(0, 4).toLowerCase()))).toBe(true);
  });

  it('a tier with no match gives nothing', () => {
    expect(filterAdversaries(all, { query: 'zzzz-nothing', tier: null, type: null })).toEqual([]);
  });
});

describe('encounterEvents', () => {
  let n = 0;
  const nextId = () => `adv-${(n += 1)}`;

  it('one adversary into an empty encounter keeps its plain name', () => {
    expect(encounterEvents([], 'acid-burrower', 'Acid Burrower', 1, nextId)).toEqual([
      { type: 'addAdversary', instanceId: expect.any(String), adversaryId: 'acid-burrower', name: 'Acid Burrower' },
    ]);
  });

  it('several are lettered, continuing after the ones already in play', () => {
    const inPlay: AdversaryInstance[] = [
      { instanceId: 'x', adversaryId: 'acid-burrower', name: 'Acid Burrower A', hpMarked: 0, stressMarked: 0, usedFeatures: [] },
    ];
    const events = encounterEvents(inPlay, 'acid-burrower', 'Acid Burrower', 2, nextId);
    expect(events.map((e) => e.name)).toEqual(['Acid Burrower B', 'Acid Burrower C']);
    expect(new Set(events.map((e) => e.instanceId)).size).toBe(2);
  });
});

describe('parseQuantityDraft', () => {
  it('reads a whole number, clamped to 1..20', () => {
    expect(parseQuantityDraft('15')).toBe(15);
    expect(parseQuantityDraft(' 7 ')).toBe(7);
    expect(parseQuantityDraft('35')).toBe(20);
    expect(parseQuantityDraft('0')).toBe(1);
  });

  it('has nothing to commit for an empty or unreadable draft', () => {
    expect(parseQuantityDraft('')).toBeNull();
    expect(parseQuantityDraft('abc')).toBeNull();
    expect(parseQuantityDraft('2.5')).toBeNull();
  });
});

describe('createLatestGate', () => {
  it('only the most recent ticket is current, so an older response is dropped', () => {
    const gate = createLatestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
  });
});
