import { LibraryCharacterSchema, type LibraryCharacter, type SheetState } from '@daggerheart/protocol';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { t, type MessageKey } from '../i18n/index.js';
import { parseLibrary } from './library.js';
import { SERVER_URL } from './useCampaign.js';

export interface LibraryConnection {
  characters: readonly LibraryCharacter[];
  /** False until the first list has arrived, so an empty library is not flashed. */
  loaded: boolean;
  pending: boolean;
  error: string | null;
  dismissError: () => void;
  refresh: () => Promise<void>;
  /** `importId` makes the create idempotent; see `CreateCharacterRequest`. */
  create: (sheet: SheetState, importId?: string) => Promise<LibraryCharacter | null>;
  remove: (characterId: string) => Promise<boolean>;
  link: (characterId: string, campaignId: string) => Promise<boolean>;
  unlink: (characterId: string) => Promise<boolean>;
}

const ERROR_KEYS: Record<string, MessageKey> = {
  alreadyLinked: 'library.error.alreadyLinked',
  campaignHasCharacter: 'library.error.campaignHasCharacter',
  forbidden: 'library.error.notAMember',
  linked: 'library.error.linked',
};

async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as unknown;
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      const key = ERROR_KEYS[body.error];
      if (key !== undefined) return t(key);
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return t('library.error.generic');
}

/**
 * The account's character library on the server. Linked characters come back
 * with the room's live sheet, so this list is always current; it is re-read after
 * every change rather than patched locally.
 */
export function useLibrary(token: string | null, onSessionExpired: () => void): LibraryConnection {
  const [characters, setCharacters] = useState<LibraryCharacter[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(
    async (method: string, path: string, body?: unknown): Promise<Response | null> => {
      if (token === null) return null;
      const response = await fetch(`${SERVER_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }).catch(() => null);
      if (response === null) {
        setError(t('library.error.generic'));
        return null;
      }
      if (response.status === 401) {
        onSessionExpired();
        return null;
      }
      return response;
    },
    [token, onSessionExpired],
  );

  const refresh = useCallback(async () => {
    const response = await request('GET', '/characters');
    if (response?.ok === true) setCharacters(parseLibrary(await response.json()));
    setLoaded(true);
  }, [request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs one mutation; on success re-reads the list, on failure says why. */
  const mutate = useCallback(
    async (method: string, path: string, body?: unknown): Promise<Response | null> => {
      setPending(true);
      try {
        const response = await request(method, path, body);
        if (response === null) return null;
        if (!response.ok) {
          setError(await describeFailure(response));
          return null;
        }
        setError(null);
        await refresh();
        return response;
      } finally {
        setPending(false);
      }
    },
    [request, refresh],
  );

  const create = useCallback(
    async (sheet: SheetState, importId?: string): Promise<LibraryCharacter | null> => {
      const response = await mutate('POST', '/characters', importId === undefined ? { sheet } : { sheet, importId });
      if (response === null) return null;
      const parsed = LibraryCharacterSchema.safeParse(await response.json());
      return parsed.success ? parsed.data : null;
    },
    [mutate],
  );

  const remove = useCallback(
    async (characterId: string) => (await mutate('DELETE', `/characters/${characterId}`)) !== null,
    [mutate],
  );
  const link = useCallback(
    async (characterId: string, campaignId: string) =>
      (await mutate('POST', `/characters/${characterId}/link`, { campaignId })) !== null,
    [mutate],
  );
  const unlink = useCallback(
    async (characterId: string) => (await mutate('POST', `/characters/${characterId}/unlink`)) !== null,
    [mutate],
  );
  const dismissError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ characters, loaded, pending, error, dismissError, refresh, create, remove, link, unlink }),
    [characters, loaded, pending, error, dismissError, refresh, create, remove, link, unlink],
  );
}
