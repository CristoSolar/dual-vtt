import { describe, expect, it } from 'vitest';

import { loadAuth, saveAuth } from '../src/state/auth.js';
import { fakeStorage } from './helpers.js';

const user = { id: 'u-1', username: 'alex', role: 'player' as const, mustChangePassword: false };

describe('auth storage', () => {
  it('round-trips a saved session', () => {
    const storage = fakeStorage();
    saveAuth(storage, { token: 'tok-123', user });
    expect(loadAuth(storage)).toEqual({ token: 'tok-123', user });
  });

  it('returns null when nothing is saved', () => {
    expect(loadAuth(fakeStorage())).toBeNull();
  });

  it('clears the entry when saving null', () => {
    const storage = fakeStorage();
    saveAuth(storage, { token: 'tok-123', user });
    saveAuth(storage, null);
    expect(loadAuth(storage)).toBeNull();
  });

  it('discards a payload with no token', () => {
    const storage = fakeStorage();
    storage.setItem('daggerheart-vtt:auth', JSON.stringify({ user }));
    expect(loadAuth(storage)).toBeNull();
  });

  it('discards a payload whose user does not match the schema', () => {
    const storage = fakeStorage();
    storage.setItem(
      'daggerheart-vtt:auth',
      JSON.stringify({ token: 'tok-123', user: { id: 'u-1', role: 'wizard' } }),
    );
    expect(loadAuth(storage)).toBeNull();
  });

  it('discards unparseable JSON instead of throwing', () => {
    const storage = fakeStorage();
    storage.setItem('daggerheart-vtt:auth', 'not json');
    expect(loadAuth(storage)).toBeNull();
  });
});
