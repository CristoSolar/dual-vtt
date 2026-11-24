import { seededRng } from '@daggerheart/rules';
import { describe, expect, it } from 'vitest';

import {
  applyRoomEvent,
  AvatarSchema,
  CharacterDetailsSchema,
  createRoomState,
  createSheet,
  editSheetDetails,
  EditCharacterRequestSchema,
  RoomEventSchema,
  SheetStateSchema,
  type Actor,
  type RoomState,
  type SheetState,
} from '../src/index.js';

import { makeCharacter } from './helpers.js';

const GM: Actor = { id: 'gm-1', role: 'gm' };
const ALEX: Actor = { id: 'acc-alex', role: 'player' };
const SAM: Actor = { id: 'acc-sam', role: 'player' };
const sheet = (): SheetState => createSheet(makeCharacter());

/** Alex's character is in the room, but Alex has never sat down. */
function room(): RoomState {
  const base = createRoomState('c-1', { id: GM.id, name: 'GM', connected: true });
  return {
    ...base,
    players: [{ id: SAM.id, name: 'Sam', connected: true, characterId: SAM.id }],
    characters: { [ALEX.id]: sheet(), [SAM.id]: sheet() },
  };
}

describe('CharacterDetailsSchema', () => {
  it('accepts the story fields', () => {
    expect(
      CharacterDetailsSchema.safeParse({
        name: 'Kael',
        pronouns: 'él',
        background: 'Grew up by the sea.',
        connections: [{ withCharacter: 'Mira', description: 'Owes me a favour' }],
        experienceNames: [{ from: 'Blacksmith', to: 'Smith' }],
      }).success,
    ).toBe(true);
    expect(CharacterDetailsSchema.safeParse({}).success).toBe(true);
  });

  it('refuses mechanics and anything else it does not know', () => {
    expect(EditCharacterRequestSchema.safeParse({ name: 'Kael', level: 10 }).success).toBe(false);
    expect(EditCharacterRequestSchema.safeParse({ traits: { agility: 9 } }).success).toBe(false);
    expect(
      EditCharacterRequestSchema.safeParse({ experienceNames: [{ from: 'A', to: 'B', modifier: 5 }] }).success,
    ).toBe(false);
  });

  it('bounds lengths', () => {
    expect(CharacterDetailsSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
    expect(CharacterDetailsSchema.safeParse({ pronouns: 'x'.repeat(41) }).success).toBe(false);
    expect(CharacterDetailsSchema.safeParse({ background: 'x'.repeat(4001) }).success).toBe(false);
    expect(
      CharacterDetailsSchema.safeParse({ connections: [{ withCharacter: ' ', description: 'x' }] }).success,
    ).toBe(false);
    expect(CharacterDetailsSchema.safeParse({ experienceNames: [{ from: 'A', to: '  ' }] }).success).toBe(false);
  });

  it('is part of the room intents', () => {
    expect(
      RoomEventSchema.safeParse({ type: 'editCharacterDetails', characterId: 'a', details: { name: 'K' } }).success,
    ).toBe(true);
    expect(
      RoomEventSchema.safeParse({ type: 'editCharacterDetails', characterId: 'a', details: { level: 2 } }).success,
    ).toBe(false);
  });
});

describe('editSheetDetails', () => {
  it('changes only what it was given', () => {
    const before = sheet();
    const result = editSheetDetails(before, { name: '  Kael ' });
    if (!result.ok) throw new Error(result.message);
    expect(result.sheet.character.name).toBe('Kael');
    expect(result.sheet.character.background).toBe(before.character.background);
    expect(result.sheet.character.traits).toEqual(before.character.traits);
    expect(result.sheet.hpMarked).toBe(before.hpMarked);
  });

  it('clears a blank name and pronouns back to unset', () => {
    const result = editSheetDetails(sheet(), { name: '   ', pronouns: '' });
    if (!result.ok) throw new Error(result.message);
    expect(result.sheet.character.name).toBeNull();
    expect(result.sheet.character.pronouns).toBeNull();
  });

  it('renames Experiences keeping their modifiers, order and nothing else', () => {
    const result = editSheetDetails(sheet(), { experienceNames: [{ from: 'Blacksmith', to: 'Herrero' }] });
    if (!result.ok) throw new Error(result.message);
    expect(result.sheet.character.experiences).toEqual({ Herrero: 2, Survivor: 2 });
    expect(Object.keys(result.sheet.character.experiences)).toEqual(['Herrero', 'Survivor']);
  });

  it('lets two Experiences swap names', () => {
    const result = editSheetDetails(sheet(), {
      experienceNames: [
        { from: 'Blacksmith', to: 'Survivor' },
        { from: 'Survivor', to: 'Blacksmith' },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('refuses an unknown Experience or two with the same name', () => {
    const unknown = editSheetDetails(sheet(), { experienceNames: [{ from: 'Nope', to: 'X' }] });
    expect(unknown.ok ? null : unknown.error).toBe('unknownExperience');
    const clash = editSheetDetails(sheet(), { experienceNames: [{ from: 'Blacksmith', to: 'Survivor' }] });
    expect(clash.ok ? null : clash.error).toBe('rejected');
  });
});

describe('editCharacterDetails intent', () => {
  const event = (characterId: string) =>
    ({ type: 'editCharacterDetails', characterId, details: { name: 'Kael' } }) as const;
  const run = (actor: Actor, characterId: string) =>
    applyRoomEvent(room(), actor, event(characterId), seededRng(1), 0);

  it('lets a player rename their own character, seated or not', () => {
    const result = run(ALEX, ALEX.id);
    if (!result.ok) throw new Error(result.message);
    expect(result.state.characters[ALEX.id]?.character.name).toBe('Kael');
    expect(result.state.characters[SAM.id]?.character.name).toBe('Test Character');
  });

  it('refuses another player and the GM', () => {
    const other = run(SAM, ALEX.id);
    expect(other.ok ? null : other.error).toBe('notYourCharacter');
    const gm = run(GM, ALEX.id);
    expect(gm.ok ? null : gm.error).toBe('notYourCharacter');
  });

  it('refuses a character not in the room', () => {
    const result = applyRoomEvent(
      { ...room(), characters: {} },
      ALEX,
      event(ALEX.id),
      seededRng(1),
      0,
    );
    expect(result.ok ? null : result.error).toBe('unknownCharacter');
  });
});

describe('avatar', () => {
  const upload = { kind: 'upload', url: '/uploads/0123456789abcdef01234567.png', crop: { x: 40, y: 60, zoom: 1.5 } };

  it('accepts the three kinds, and only server paths for an upload', () => {
    expect(AvatarSchema.safeParse({ kind: 'ancestry', ancestryId: 'elf' }).success).toBe(true);
    expect(AvatarSchema.safeParse({ kind: 'gallery', id: 'elf-2' }).success).toBe(true);
    expect(AvatarSchema.safeParse(upload).success).toBe(true);
    for (const url of ['https://evil.example/x.png', 'javascript:alert(1)', '/uploads/../users.json', '/uploads/abc.ogg']) {
      expect(AvatarSchema.safeParse({ kind: 'upload', url }).success).toBe(false);
    }
    expect(AvatarSchema.safeParse({ kind: 'gallery', id: '../secret' }).success).toBe(false);
    expect(AvatarSchema.safeParse({ ...upload, crop: { x: 0, y: 0, zoom: 9 } }).success).toBe(false);
  });

  it('defaults to null — the ancestry art — on a sheet saved before avatars', () => {
    const { avatar: _dropped, ...old } = sheet();
    const parsed = SheetStateSchema.parse(old);
    expect(parsed.avatar).toBeNull();
  });

  it('is changed, and cleared, by a details edit', () => {
    const edited = editSheetDetails(sheet(), EditCharacterRequestSchema.parse({ avatar: upload }));
    expect(edited.ok && edited.sheet.avatar).toEqual(upload);
    if (!edited.ok) return;
    // Leaving it out keeps it; null goes back to the ancestry art.
    const renamed = editSheetDetails(edited.sheet, { name: 'Kael' });
    expect(renamed.ok && renamed.sheet.avatar).toEqual(upload);
    const cleared = editSheetDetails(edited.sheet, { avatar: null });
    expect(cleared.ok && cleared.sheet.avatar).toBeNull();
  });
});
