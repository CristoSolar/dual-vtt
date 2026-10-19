import { seededRng, type Rng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import {
  applyRoomEvent,
  createRoomState,
  roomForRole,
  roomPatch,
  RoomStateSchema,
  SceneSchema,
  type Actor,
  type JournalEntry,
  type RoomEvent,
  type RoomState,
} from '../src/index.js';

/**
 * The GM's journal and the map notes that pin its entries to scenes. Players only
 * ever receive entries shared with them, and only the notes pointing at those.
 */

const GM: Actor = { id: 'gm-1', role: 'gm' };
const ALEX: Actor = { id: 'acc-alex', role: 'player' };

const rng: Rng = seededRng(7);
const NOW = 1_700_000_000_000;

function apply(state: RoomState, actor: Actor, event: RoomEvent): RoomState {
  const result = applyRoomEvent(state, actor, event, rng, NOW);
  if (!result.ok) throw new Error(`rejected: ${result.error} ${result.message}`);
  return result.state;
}

function refusal(state: RoomState, actor: Actor, event: RoomEvent): string {
  const result = applyRoomEvent(state, actor, event, rng, NOW);
  if (result.ok) throw new Error('expected a refusal, got a new state');
  return result.error;
}

const entry = (id: string, shared: JournalEntry['shared']): JournalEntry => ({
  id,
  title: `Entry ${id}`,
  body: 'Lore.',
  image: null,
  shared,
});

/** A room with an active scene, a secret entry, a shared entry, and a note to each. */
function roomWithJournal(): RoomState {
  let room = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
  room = {
    ...room,
    players: [{ id: ALEX.id, name: 'Alex', connected: true, characterId: null }],
  };
  room = apply(room, GM, { type: 'addScene', id: 's-1', name: 'Town' });
  room = apply(room, GM, { type: 'setActiveScene', id: 's-1' });
  room = apply(room, GM, { type: 'upsertJournalEntry', entry: entry('j-secret', 'gm') });
  room = apply(room, GM, { type: 'upsertJournalEntry', entry: entry('j-open', 'all') });
  room = apply(room, GM, {
    type: 'addNote',
    sceneId: 's-1',
    note: { id: 'n-secret', x: 10, y: 10, journalId: 'j-secret' },
  });
  room = apply(room, GM, {
    type: 'addNote',
    sceneId: 's-1',
    note: { id: 'n-open', x: 20, y: 20, journalId: 'j-open' },
  });
  return room;
}

describe('journal intents', () => {
  it('are GM-only', () => {
    const room = roomWithJournal();
    const events: RoomEvent[] = [
      { type: 'upsertJournalEntry', entry: entry('j-x', 'all') },
      { type: 'removeJournalEntry', id: 'j-open' },
      { type: 'addNote', sceneId: 's-1', note: { id: 'n-x', x: 0, y: 0, journalId: 'j-open' } },
      { type: 'removeNote', sceneId: 's-1', noteId: 'n-open' },
    ];
    for (const event of events) expect(refusal(room, ALEX, event)).toBe('notGameMaster');
  });

  it('upserting an existing id replaces that entry in place', () => {
    const room = apply(roomWithJournal(), GM, {
      type: 'upsertJournalEntry',
      entry: { ...entry('j-secret', 'all'), title: 'Revealed' },
    });
    expect(room.journal.map((e) => e.id)).toEqual(['j-secret', 'j-open']);
    expect(room.journal[0]?.title).toBe('Revealed');
    expect(room.journal[0]?.shared).toBe('all');
  });

  it('removing an entry removes its notes on every scene', () => {
    let room = roomWithJournal();
    room = apply(room, GM, { type: 'addScene', id: 's-2', name: 'Woods' });
    room = apply(room, GM, {
      type: 'addNote',
      sceneId: 's-2',
      note: { id: 'n-secret-2', x: 5, y: 5, journalId: 'j-secret' },
    });
    room = apply(room, GM, { type: 'removeJournalEntry', id: 'j-secret' });
    expect(room.journal.map((e) => e.id)).toEqual(['j-open']);
    expect(room.map.scenes.flatMap((s) => s.notes.map((n) => n.id))).toEqual(['n-open']);
  });

  it('refuses a note on an unknown scene or for an unknown entry', () => {
    const room = roomWithJournal();
    const note = { id: 'n-x', x: 0, y: 0, journalId: 'j-open' };
    expect(refusal(room, GM, { type: 'addNote', sceneId: 'nope', note })).toBe('unknownScene');
    expect(
      refusal(room, GM, { type: 'addNote', sceneId: 's-1', note: { ...note, journalId: 'nope' } }),
    ).toBe('unknownJournalEntry');
  });

  it('removes a single note', () => {
    const room = apply(roomWithJournal(), GM, {
      type: 'removeNote',
      sceneId: 's-1',
      noteId: 'n-secret',
    });
    expect(room.map.scenes[0]?.notes.map((n) => n.id)).toEqual(['n-open']);
  });
});

describe('what a player receives', () => {
  it('only shared entries, and only notes pointing at them', () => {
    const forPlayer = roomForRole(roomWithJournal(), 'player');
    expect(forPlayer.journal.map((e) => e.id)).toEqual(['j-open']);
    expect(forPlayer.map.scenes[0]?.notes.map((n) => n.id)).toEqual(['n-open']);
  });

  it('the GM receives everything', () => {
    const forGm = roomForRole(roomWithJournal(), 'gm');
    expect(forGm.journal).toHaveLength(2);
    expect(forGm.map.scenes[0]?.notes).toHaveLength(2);
  });

  it('keeps the same journal reference when nothing is filtered', () => {
    let room = roomWithJournal();
    room = apply(room, GM, { type: 'removeJournalEntry', id: 'j-secret' });
    expect(roomForRole(room, 'player').journal).toBe(room.journal);
  });

  it('player patch has no journal when only something else changed', () => {
    const before = roomWithJournal();
    const after = apply(before, GM, { type: 'gainFear', amount: 1 });
    const patch = roomPatch(roomForRole(before, 'player'), roomForRole(after, 'player'));
    expect(patch.fear).toBe(1);
    expect(patch).not.toHaveProperty('journal');
  });

  it('player patch has no journal when only a GM-only entry changed', () => {
    const before = roomWithJournal();
    const after = apply(before, GM, {
      type: 'upsertJournalEntry',
      entry: { ...entry('j-secret', 'gm'), body: 'More secrets.' },
    });
    const patch = roomPatch(roomForRole(before, 'player'), roomForRole(after, 'player'));
    expect(patch).not.toHaveProperty('journal');
  });

  it('the journal travels in the GM patch', () => {
    const before = roomWithJournal();
    const after = apply(before, GM, { type: 'removeJournalEntry', id: 'j-open' });
    expect(roomPatch(before, after).journal?.map((e) => e.id)).toEqual(['j-secret']);
  });
});

describe('old snapshots', () => {
  it('load without a journal or scene notes', () => {
    const { journal: _dropped, ...old } = roomWithJournal();
    const scenes = old.map.scenes.map(({ notes: _notes, ...scene }) => scene);
    const parsed = RoomStateSchema.parse({ ...old, map: { ...old.map, scenes } });
    expect(parsed.journal).toEqual([]);
    expect(parsed.map.scenes[0]?.notes).toEqual([]);
    expect(SceneSchema.parse(scenes[0]).notes).toEqual([]);
  });
});
