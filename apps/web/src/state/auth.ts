import { LoginResponseSchema, SetupStatusSchema, UserSchema, type User } from '@daggerheart/protocol';
import { useCallback, useEffect, useState } from 'react';

import { t } from '../i18n/index.js';
import { SERVER_URL } from './useCampaign.js';

/**
 * Login session persistence. Same trust-boundary rule as `storage.ts`: a saved
 * payload is checked on read, never cast, so a half-written or stale value
 * surfaces as "not logged in" instead of crashing.
 */

const AUTH_KEY = 'daggerheart-vtt:auth';

export interface StoredAuth {
  token: string;
  user: User;
}

/** The browser storage this module reads and writes. Injected so tests can fake it. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadAuth(storage: StorageLike): StoredAuth | null {
  const raw = storage.getItem(AUTH_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { token, user } = parsed as Record<string, unknown>;
  if (typeof token !== 'string' || token === '') return null;

  const parsedUser = UserSchema.safeParse(user);
  if (!parsedUser.success) return null;
  return { token, user: parsedUser.data };
}

export function saveAuth(storage: StorageLike, auth: StoredAuth | null): void {
  if (auth === null) storage.removeItem(AUTH_KEY);
  else storage.setItem(AUTH_KEY, JSON.stringify(auth));
}

/**
 * Whether a socket's failed connect was the server refusing the token — sessions
 * live in memory, so a server restart kills every one — rather than the network.
 * Only the former should sign the player out; a Wi-Fi blip just retries.
 */
export function isAuthRejection(error: { message: string }): boolean {
  return error.message === 'unauthorized';
}

/**
 * Whether the server still has no GM and offers to create one (desktop app, first
 * run). Anything but a clear yes — an older server without the route, a network
 * error — means "no": the login screen is the safe default.
 */
export function parseSetupStatus(body: unknown): boolean {
  const parsed = SetupStatusSchema.safeParse(body);
  return parsed.success && parsed.data.needsSetup;
}

async function fetchNeedsSetup(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/setup`);
    if (!response.ok) return false;
    return parseSetupStatus(await response.json());
  } catch {
    return false;
  }
}

/** `setup` is the first-run screen: no GM exists yet, so there is nobody to sign in as. */
export type AuthStatus = 'loading' | 'setup' | 'signedOut' | 'signedIn';

export interface AuthConnection {
  status: AuthStatus;
  user: User | null;
  token: string | null;
  error: string | null;
  /** True while a `login`/`changePassword` request is in flight — disable the
   * submit button on this, not just field validation, or a double-click/double-
   * Enter fires the request twice. */
  pending: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  /** Drops a token the server no longer accepts and asks the player to sign in
   * again. Only the token goes: drafts and the active campaign stay put. */
  expire: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Creates the first GM (status `setup` only) and signs it in. */
  setup: (username: string, password: string) => Promise<void>;
}

/**
 * Owns the logged-in account. Same shape as `useRoom`: the server decides, this
 * only renders whatever it said and persists the token for next time.
 */
export function useAuth(storage: StorageLike): AuthConnection {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const saved = loadAuth(storage);
    const signedOut = (): void => {
      void fetchNeedsSetup().then((needed) => setStatus(needed ? 'setup' : 'signedOut'));
    };
    if (saved === null) {
      signedOut();
      return;
    }
    fetch(`${SERVER_URL}/me`, { headers: { authorization: `Bearer ${saved.token}` } })
      .then((response) => {
        if (!response.ok) throw new Error('stale session');
        return response.json() as Promise<unknown>;
      })
      .then((body) => {
        const parsedUser = UserSchema.safeParse(body);
        if (!parsedUser.success) throw new Error('bad response');
        setAuth({ token: saved.token, user: parsedUser.data });
        setStatus('signedIn');
      })
      .catch(() => {
        saveAuth(storage, null);
        signedOut();
      });
  }, [storage]);

  const login = useCallback(
    async (username: string, password: string) => {
      setError(null);
      setPending(true);
      try {
        const response = await fetch(`${SERVER_URL}/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!response.ok) {
          setError(t('auth.invalidCredentials'));
          return;
        }
        const body = (await response.json()) as { token: string; user: unknown };
        const parsedUser = UserSchema.safeParse(body.user);
        if (!parsedUser.success) {
          setError(t('auth.unexpectedResponse'));
          return;
        }
        const next: StoredAuth = { token: body.token, user: parsedUser.data };
        saveAuth(storage, next);
        setAuth(next);
        setStatus('signedIn');
      } finally {
        setPending(false);
      }
    },
    [storage],
  );

  const logout = useCallback(() => {
    const saved = loadAuth(storage);
    saveAuth(storage, null);
    setAuth(null);
    setStatus('signedOut');
    if (saved !== null) {
      void fetch(`${SERVER_URL}/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${saved.token}` },
      });
    }
  }, [storage]);

  const expire = useCallback(() => {
    saveAuth(storage, null);
    setAuth(null);
    setError(t('auth.sessionExpired'));
    setStatus('signedOut');
  }, [storage]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      setError(null);
      if (auth === null) return;
      setPending(true);
      try {
        const response = await fetch(`${SERVER_URL}/change-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.token}` },
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        if (!response.ok) {
          setError(t('auth.wrongCurrentPassword'));
          return;
        }
        const next: StoredAuth = { token: auth.token, user: { ...auth.user, mustChangePassword: false } };
        saveAuth(storage, next);
        setAuth(next);
      } finally {
        setPending(false);
      }
    },
    [auth, storage],
  );

  const setup = useCallback(
    async (username: string, password: string) => {
      setError(null);
      setPending(true);
      try {
        const response = await fetch(`${SERVER_URL}/setup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password }),
        }).catch(() => null);
        if (response === null) {
          setError(t('setup.failed'));
          return;
        }
        if (response.status === 409) {
          setError(t('setup.alreadyDone'));
          setStatus('signedOut');
          return;
        }
        if (response.status === 400) {
          setError(t('setup.invalid'));
          return;
        }
        const parsed = LoginResponseSchema.safeParse(await response.json().catch(() => null));
        if (!response.ok || !parsed.success) {
          setError(t('setup.failed'));
          return;
        }
        saveAuth(storage, parsed.data);
        setAuth(parsed.data);
        setStatus('signedIn');
      } finally {
        setPending(false);
      }
    },
    [storage],
  );

  return {
    status,
    user: auth?.user ?? null,
    token: auth?.token ?? null,
    error,
    pending,
    login,
    logout,
    expire,
    changePassword,
    setup,
  };
}
