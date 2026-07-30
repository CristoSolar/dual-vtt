import { CharacterSchema, deserialize, serialize, type CreationState } from '@daggerheart/character';
import type { Gold } from '@daggerheart/rules';

import type { SheetState } from './sheet.js';

/**
 * localStorage persistence. Everything is checked on read rather than cast: saved
 * data is a trust boundary, and a half-written or stale payload should surface as a
 * clean "not found" instead of crashing mid-session.
 *
 * Validation is hand-rolled rather than schema-driven so this app needs no
 * dependency beyond React, the router, and the workspace packages.
 */

const KEY_PREFIX = 'daggerheart-vtt';
export const SAVED_CHARACTERS_KEY = `${KEY_PREFIX}:characters`;
export const IN_PROGRESS_KEY = `${KEY_PREFIX}:creation`;
export const ACTIVE_CHARACTER_KEY = `${KEY_PREFIX}:active`;

export interface SavedCharacter {
  id: string;
  sheet: SheetState;
  /** Epoch milliseconds, supplied by the caller so this module stays pure. */
  updatedAt: number;
}

/** The browser storage this module reads and writes. Injected so tests can fake it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'string');

function parseGold(value: unknown): Gold | null {
  if (!isRecord(value)) return null;
  const { handfuls, bags, chests } = value;
  if (!isCount(handfuls) || !isCount(bags) || !isCount(chests)) return null;
  return { handfuls, bags, chests };
}

function parseSheet(value: unknown): SheetState | null {
  if (!isRecord(value)) return null;

  const character = CharacterSchema.safeParse(value.character);
  if (!character.success) return null;

  const gold = parseGold(value.gold);
  if (gold === null) return null;

  const { hpMarked, stressMarked, hope, armorSlotsMarked, loadout, vault } = value;
  if (
    !isCount(hpMarked) ||
    !isCount(stressMarked) ||
    !isCount(hope) ||
    !isCount(armorSlotsMarked) ||
    !isStringArray(loadout) ||
    !isStringArray(vault)
  ) {
    return null;
  }

  return {
    character: character.data,
    hpMarked,
    stressMarked,
    hope,
    armorSlotsMarked,
    gold,
    loadout,
    vault,
  };
}

function parseSaved(value: unknown): SavedCharacter | null {
  if (!isRecord(value)) return null;
  const { id, updatedAt } = value;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;

  const sheet = parseSheet(value.sheet);
  if (sheet === null) return null;
  return { id, sheet, updatedAt };
}

function readJson(storage: StorageLike, key: string): unknown {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Every saved character, newest first. Entries that no longer parse are dropped
 * rather than failing the whole load, so one bad record can't lock you out.
 */
export function loadCharacters(storage: StorageLike): SavedCharacter[] {
  const raw = readJson(storage, SAVED_CHARACTERS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseSaved)
    .filter((c): c is SavedCharacter => c !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveCharacters(storage: StorageLike, characters: readonly SavedCharacter[]): void {
  storage.setItem(SAVED_CHARACTERS_KEY, JSON.stringify(characters));
}

/** Inserts or replaces one character, leaving the others untouched. */
export function upsertCharacter(
  characters: readonly SavedCharacter[],
  id: string,
  sheet: SheetState,
  now: number,
): SavedCharacter[] {
  const entry: SavedCharacter = { id, sheet, updatedAt: now };
  const index = characters.findIndex((c) => c.id === id);
  if (index === -1) return [...characters, entry];
  return characters.map((c, i) => (i === index ? entry : c));
}

export function removeCharacter(
  characters: readonly SavedCharacter[],
  id: string,
): SavedCharacter[] {
  return characters.filter((c) => c.id !== id);
}

/** Persists an in-progress creation so a reload resumes at the same step. */
export function saveCreation(storage: StorageLike, state: CreationState): void {
  storage.setItem(IN_PROGRESS_KEY, serialize(state));
}

/** Restores an in-progress creation, or null if there is none or it is unreadable. */
export function loadCreation(storage: StorageLike): CreationState | null {
  const raw = storage.getItem(IN_PROGRESS_KEY);
  if (raw === null) return null;
  try {
    return deserialize(raw);
  } catch {
    return null;
  }
}

export function clearCreation(storage: StorageLike): void {
  storage.removeItem(IN_PROGRESS_KEY);
}

export function loadActiveId(storage: StorageLike): string | null {
  const value = storage.getItem(ACTIVE_CHARACTER_KEY);
  return value === null || value === '' ? null : value;
}

export function saveActiveId(storage: StorageLike, id: string | null): void {
  if (id === null) storage.removeItem(ACTIVE_CHARACTER_KEY);
  else storage.setItem(ACTIVE_CHARACTER_KEY, id);
}
