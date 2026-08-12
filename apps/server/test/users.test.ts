import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hashPassword, verifyPasswordHash } from '../src/passwords.js';
import { UserStore } from '../src/users.js';
import { readUsersSnapshot, writeUsersSnapshot } from '../src/users-snapshot.js';

describe('password hashing', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse');
    expect(await verifyPasswordHash('correct-horse', hash)).toBe(true);
    expect(await verifyPasswordHash('wrong', hash)).toBe(false);
  });

  it('salts each hash differently, even for the same password', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
  });
});

describe('UserStore', () => {
  it('creates a user that must change their password, and never returns the hash', async () => {
    const store = new UserStore();
    const user = await store.createUser('alex', 'initial-pw', 'player');
    expect(user.mustChangePassword).toBe(true);
    expect(user.role).toBe('player');
    expect(JSON.stringify(user)).not.toContain('initial-pw');
    expect('passwordHash' in user).toBe(false);
  });

  it('verifies login against the stored hash', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'initial-pw', 'player');
    expect(await store.verifyLogin('alex', 'initial-pw')).not.toBeNull();
    expect(await store.verifyLogin('alex', 'wrong')).toBeNull();
    expect(await store.verifyLogin('nobody', 'initial-pw')).toBeNull();
  });

  it('changes the password and clears mustChangePassword', async () => {
    const store = new UserStore();
    const created = await store.createUser('alex', 'initial-pw', 'player');
    const ok = await store.setPassword(created.id, 'new-pw', false);
    expect(ok).toBe(true);
    expect(await store.verifyLogin('alex', 'new-pw')).not.toBeNull();
    expect(await store.verifyLogin('alex', 'initial-pw')).toBeNull();
  });

  it('lists only players when filtered by role', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'x', 'player');
    await store.createUser('gm', 'y', 'gm');
    expect(store.list('player').map((u) => u.username)).toEqual(['alex']);
  });

  it('round-trips through serialize/restore', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'initial-pw', 'player');
    await store.createUser('gm', 'gm-pw', 'gm');

    const restored = new UserStore();
    restored.restore(store.serialize());

    expect(restored.list().map((u) => u.username).sort()).toEqual(['alex', 'gm']);
    expect(await restored.verifyLogin('alex', 'initial-pw')).not.toBeNull();
  });
});

describe('users snapshot file', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dh-users-'));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads back exactly what it wrote', async () => {
    const store = new UserStore();
    await store.createUser('alex', 'initial-pw', 'player');
    const path = join(directory, 'users.json');

    await writeUsersSnapshot(path, store.serialize());
    const restored = await readUsersSnapshot(path);

    const fresh = new UserStore();
    fresh.restore(restored);
    expect(await fresh.verifyLogin('alex', 'initial-pw')).not.toBeNull();
  });

  it('returns an empty array when the file does not exist', async () => {
    expect(await readUsersSnapshot(join(directory, 'missing.json'))).toEqual([]);
  });

  it('discards unreadable JSON instead of throwing', async () => {
    const path = join(directory, 'corrupt.json');
    await writeUsersSnapshot(path, []);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path, 'not json', 'utf8');
    expect(await readUsersSnapshot(path)).toEqual([]);
  });
});
