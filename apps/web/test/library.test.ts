import { createInitialState, serialize } from '@daggerheart/character';
import { createSheet, type CampaignSummary, type LibraryCharacter } from '@daggerheart/protocol';
import { describe, expect, it } from 'vitest';

import {
  characterIn,
  characterPortrait,
  detailsRequest,
  draftFromSheet,
  DRAFT_SCOPE,
  findLegacyCharacters,
  linkableCampaigns,
  markLegacyImported,
  parseCampaignList,
  parseLibrary,
  playableCampaign,
} from '../src/state/library.js';
import { buildCharacter, buildCreationState, fakeStorage } from './helpers.js';

const ME = 'u-me';

const summary = (id: string, ownerId = 'u-gm'): CampaignSummary => ({
  id,
  name: `Campaign ${id}`,
  ownerId,
  ownerUsername: 'gm',
  memberIds: [ME],
  invitedIds: [],
  status: 'active',
});

const entry = (id: string, campaignId: string | null): LibraryCharacter => ({
  id,
  ownerId: ME,
  sheet: createSheet(buildCharacter()),
  campaignId,
  campaignName: campaignId,
  updatedAt: 0,
});

describe('library responses', () => {
  it('keeps the readable entries of a list and drops the rest', () => {
    const good = entry('ch-1', null);
    expect(parseLibrary([good, { id: 'bad' }])).toEqual([good]);
    expect(parseLibrary({ not: 'a list' })).toEqual([]);
  });

  it('reads the campaign list as member and invited', () => {
    const list = { member: [summary('a')], invited: [summary('b')] };
    expect(parseCampaignList(list)).toEqual(list);
    expect(parseCampaignList('nonsense')).toEqual({ member: [], invited: [] });
  });
});

describe('linking choices', () => {
  it('offers campaigns I play in that have no character of mine', () => {
    const campaigns = [summary('a'), summary('b'), summary('mine', ME)];
    const characters = [entry('ch-1', 'a'), entry('ch-2', null)];

    expect(linkableCampaigns(characters, campaigns, ME).map((c) => c.id)).toEqual(['b']);
  });

  it('finds my character in a campaign', () => {
    const characters = [entry('ch-1', 'a'), entry('ch-2', null)];
    expect(characterIn(characters, 'a')?.id).toBe('ch-1');
    expect(characterIn(characters, 'b')).toBeNull();
  });

  it('points at the ancestry art', () => {
    expect(characterPortrait(createSheet(buildCharacter()))).toBe('/images/ancestries/human.png?v=3');
  });
});

describe('characters left in this browser by the old flow', () => {
  it('finds the old saved list and complete drafts as importable, incomplete drafts as resumable', () => {
    const sheet = createSheet(buildCharacter());
    const storage = fakeStorage({
      'daggerheart-vtt:characters': JSON.stringify([{ id: 'old-1', sheet, updatedAt: 1 }, { id: 'old-2', sheet: 'junk' }]),
      'daggerheart-vtt:creation:c-1': serialize(buildCreationState()),
      'daggerheart-vtt:creation:c-2': serialize(createInitialState()),
      'daggerheart-vtt:creation:c-3:unreadable': 'whatever',
      [`daggerheart-vtt:creation:${DRAFT_SCOPE}`]: serialize(createInitialState()),
    });

    const found = findLegacyCharacters(storage, [...storage.data.keys()]);
    expect(found.importable.map((i) => i.key)).toEqual([
      'daggerheart-vtt:characters',
      'daggerheart-vtt:creation:c-1',
    ]);
    expect(found.importable[0]?.sheet).toEqual(sheet);
    expect(found.unreadable).toBe(1);
    expect(found.drafts.map((d) => d.key)).toEqual(['daggerheart-vtt:creation:c-2']);
  });

  it('gives each importable character a stable, distinct import id', () => {
    const sheet = createSheet(buildCharacter());
    const storage = fakeStorage({
      'daggerheart-vtt:characters': JSON.stringify([
        { id: 'old-1', sheet, updatedAt: 1 },
        { id: 'old-2', sheet, updatedAt: 2 },
      ]),
      'daggerheart-vtt:creation:c-1': serialize(buildCreationState()),
    });
    const first = findLegacyCharacters(storage, [...storage.data.keys()]).importable.map((i) => i.importId);
    const second = findLegacyCharacters(storage, [...storage.data.keys()]).importable.map((i) => i.importId);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(3);
  });

  it('finds nothing in a clean browser', () => {
    const storage = fakeStorage();
    expect(findLegacyCharacters(storage, [])).toEqual({ importable: [], drafts: [], unreadable: 0 });
  });

  it('sets imported keys aside rather than deleting them', () => {
    const storage = fakeStorage({ 'daggerheart-vtt:creation:c-1': 'payload' });
    markLegacyImported(storage, ['daggerheart-vtt:creation:c-1']);
    expect(storage.data.get('daggerheart-vtt:creation:c-1')).toBeUndefined();
    expect(storage.data.get('daggerheart-vtt:imported:daggerheart-vtt:creation:c-1')).toBe('payload');
    expect(findLegacyCharacters(storage, [...storage.data.keys()]).importable).toEqual([]);
  });
});

describe('where "Ver hoja" leads', () => {
  it('into an active campaign the character is linked to', () => {
    expect(playableCampaign(entry('ch-1', 'c-1'), [summary('c-1')])?.id).toBe('c-1');
  });

  it('to the library view when unlinked, paused, finished or the campaign is unknown', () => {
    expect(playableCampaign(entry('ch-1', null), [summary('c-1')])).toBeNull();
    expect(playableCampaign(entry('ch-1', 'c-1'), [{ ...summary('c-1'), status: 'paused' }])).toBeNull();
    expect(playableCampaign(entry('ch-1', 'c-1'), [{ ...summary('c-1'), status: 'finished' }])).toBeNull();
    expect(playableCampaign(entry('ch-1', 'c-1'), [])).toBeNull();
  });
});

describe('the edit form', () => {
  const sheet = () => entry('ch-1', null).sheet;

  it('round-trips a sheet into a request that changes nothing but trimmed text', () => {
    const built = detailsRequest(sheet(), draftFromSheet(sheet()));
    if (!built.ok) throw new Error(built.problem);
    expect(built.request.experienceNames).toEqual([]);
    expect(built.request.name).toBe(sheet().character.name);
  });

  it('sends only the Experiences that were renamed, and blank names as null', () => {
    const draft = draftFromSheet(sheet());
    const [first, ...rest] = draft.experiences;
    const built = detailsRequest(sheet(), { ...draft, name: '  ', experiences: [`${first ?? ''} II`, ...rest] });
    if (!built.ok) throw new Error(built.problem);
    expect(built.request.name).toBeNull();
    expect(built.request.experienceNames).toEqual([{ from: first, to: `${first ?? ''} II` }]);
  });

  it('drops blank connection rows and refuses half-filled ones', () => {
    const draft = draftFromSheet(sheet());
    const blank = detailsRequest(sheet(), { ...draft, connections: [{ withCharacter: ' ', description: '' }] });
    expect(blank.ok && blank.request.connections).toEqual([]);
    const half = detailsRequest(sheet(), { ...draft, connections: [{ withCharacter: 'Mira', description: '' }] });
    expect(half.ok ? null : half.problem).toBe('halfConnection');
  });

  it('refuses an empty or repeated Experience name', () => {
    const draft = draftFromSheet(sheet());
    const empty = detailsRequest(sheet(), { ...draft, experiences: draft.experiences.map(() => '') });
    expect(empty.ok ? null : empty.problem).toBe('emptyExperience');
    const same = detailsRequest(sheet(), { ...draft, experiences: draft.experiences.map(() => 'Igual') });
    expect(same.ok ? null : same.problem).toBe('duplicateExperience');
  });
});
