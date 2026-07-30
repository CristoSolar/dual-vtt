import type { Character } from '@daggerheart/character';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { createSheet, type SheetEffect, type SheetState, type SheetTransition } from './sheet.js';
import {
  loadActiveId,
  loadCharacters,
  removeCharacter,
  saveActiveId,
  saveCharacters,
  upsertCharacter,
  type SavedCharacter,
} from './storage.js';

/** Ids are opaque; a timestamp plus a counter is unique enough for local saves. */
let idCounter = 0;
function nextId(now: number): string {
  idCounter += 1;
  return `pc-${now.toString(36)}-${idCounter.toString(36)}`;
}

/**
 * Owns every saved character and which one is active. Mutations take a
 * `SheetTransition` — the result of a pure function from `state/sheet` — so no
 * component ever computes a new sheet itself.
 */
export function useCharacters(storage: Storage) {
  const [characters, setCharacters] = useState<SavedCharacter[]>(() => loadCharacters(storage));
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId(storage));

  useEffect(() => {
    saveCharacters(storage, characters);
  }, [storage, characters]);

  useEffect(() => {
    saveActiveId(storage, activeId);
  }, [storage, activeId]);

  const active = useMemo(
    () => characters.find((c) => c.id === activeId) ?? null,
    [characters, activeId],
  );

  /** Saves a freshly finalized character and makes it active. */
  const addCharacter = useCallback((character: Character): string => {
    const now = Date.now();
    const id = nextId(now);
    setCharacters((current) => upsertCharacter(current, id, createSheet(character), now));
    setActiveId(id);
    return id;
  }, []);

  /**
   * Applies a pure transition to the active character's sheet and returns its
   * effect, so the caller can show the message or open a prompt.
   *
   * The transition is computed here rather than inside the state updater: updaters
   * can run twice under StrictMode, and a roll must never be evaluated twice.
   */
  const updateActive = useCallback(
    (transition: (sheet: SheetState) => SheetTransition): SheetEffect | null => {
      if (active === null) return null;
      const result = transition(active.sheet);
      setCharacters((current) => upsertCharacter(current, active.id, result.sheet, Date.now()));
      return result.effect;
    },
    [active],
  );

  const deleteCharacter = useCallback(
    (id: string) => {
      setCharacters((current) => removeCharacter(current, id));
      setActiveId((current) => (current === id ? null : current));
    },
    [],
  );

  return { characters, active, activeId, setActiveId, addCharacter, updateActive, deleteCharacter };
}
