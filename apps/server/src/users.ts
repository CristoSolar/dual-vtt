import { randomBytes } from 'node:crypto';

import type { User, UserRole } from '@daggerheart/protocol';

import { hashPassword, verifyPasswordHash } from './passwords.js';

/**
 * Verified against when the username does not exist, so a wrong username costs the
 * same scrypt work as a wrong password and cannot be told apart by timing.
 */
const dummyHash = hashPassword(randomBytes(32).toString('hex'));

/** The server-only shape: everything `User` has, plus the hash. Never sent to a client. */
export interface StoredUser extends User {
  passwordHash: string;
  /**
   * The GM who created this account, or null for accounts made before this was
   * recorded (and for the boot GM). Who manages a null ("legacy") player is
   * decided in `managed-players.ts`.
   */
  createdBy: string | null;
  /** When it last signed in successfully, or null if never since this was recorded. */
  lastLoginAt: number | null;
}

export function toPublic(user: StoredUser): User {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * In-memory account storage, mirroring `RoomStore`'s shape: the single source of
 * truth, with a `serialize`/`restore` pair for the disk snapshot.
 */
export class UserStore {
  private readonly users = new Map<string, StoredUser>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  get size(): number {
    return this.users.size;
  }

  /**
   * Usernames match ignoring case and surrounding spaces: a phone keyboard turns
   * "ana" into "Ana ", and "ANA" next to "ana" is two accounts nobody can tell apart.
   */
  findByUsername(username: string): StoredUser | null {
    const wanted = normalizeUsername(username);
    if (wanted === '') return null;
    for (const user of this.users.values()) {
      if (normalizeUsername(user.username) === wanted) return user;
    }
    return null;
  }

  /** The full record, hash included — for server code only, never a response. */
  findStored(id: string): StoredUser | null {
    return this.users.get(id) ?? null;
  }

  /** Every player account, hashes included — server code only. See `managed-players.ts`. */
  players(): StoredUser[] {
    return [...this.users.values()].filter((user) => user.role === 'player');
  }

  /** Records `gmId` as the creator of a legacy account. False if it already had one. */
  claim(userId: string, gmId: string): boolean {
    const user = this.users.get(userId);
    if (user === undefined || user.createdBy !== null) return false;
    user.createdBy = gmId;
    return true;
  }

  findById(id: string): User | null {
    const user = this.users.get(id);
    return user === undefined ? null : toPublic(user);
  }

  list(role?: UserRole): User[] {
    return [...this.users.values()]
      .filter((user) => role === undefined || user.role === role)
      .map(toPublic);
  }

  /**
   * New accounts start `mustChangePassword: true` — a GM-set password is temporary
   * by design. The first-run GM, who chose their own, passes false. Returns null if
   * the username is already taken.
   *
   * The record is inserted before the hash is awaited, so two concurrent creates
   * cannot both pass the name check and end up with one unreachable duplicate.
   * The placeholder hash never verifies (`verifyPasswordHash` rejects it), so the
   * account cannot be logged into during the gap.
   */
  async createUser(
    username: string,
    password: string,
    role: UserRole,
    createdBy: string | null = null,
    mustChangePassword = true,
  ): Promise<User | null> {
    const trimmed = username.trim();
    if (trimmed === '' || this.findByUsername(trimmed) !== null) return null;
    const id = `u-${randomBytes(8).toString('hex')}`;
    const user: StoredUser = {
      id,
      username: trimmed,
      role,
      mustChangePassword,
      passwordHash: '',
      createdBy,
      lastLoginAt: null,
    };
    this.users.set(id, user);
    user.passwordHash = await hashPassword(password);
    return toPublic(user);
  }

  async verifyLogin(username: string, password: string): Promise<User | null> {
    const stored = this.findByUsername(username);
    if (stored === null) {
      await verifyPasswordHash(password, await dummyHash);
      return null;
    }
    const ok = await verifyPasswordHash(password, stored.passwordHash);
    if (!ok) return null;
    stored.lastLoginAt = this.now();
    return toPublic(stored);
  }

  async setPassword(userId: string, newPassword: string, mustChangePassword: boolean): Promise<boolean> {
    const user = this.users.get(userId);
    if (user === undefined) return false;
    user.passwordHash = await hashPassword(newPassword);
    user.mustChangePassword = mustChangePassword;
    return true;
  }

  restore(records: readonly StoredUser[]): void {
    for (const record of records) this.users.set(record.id, record);
  }

  /** A JSON-serializable copy of every account, for the disk snapshot. */
  serialize(): StoredUser[] {
    return [...this.users.values()];
  }
}

/** The form two usernames are compared in. Display keeps the name as typed (trimmed). */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
