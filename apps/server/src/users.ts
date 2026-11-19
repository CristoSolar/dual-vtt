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
   * recorded (and for the boot GM). A null player is "legacy": every GM manages it.
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

  findByUsername(username: string): StoredUser | null {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    return null;
  }

  /** The full record, hash included — for server code only, never a response. */
  findStored(id: string): StoredUser | null {
    return this.users.get(id) ?? null;
  }

  /**
   * The player accounts a GM manages: the ones they created, plus legacy ones with
   * no recorded creator. Before `createdBy` existed every GM saw every player, so
   * hiding those would lose a GM their own table; with one GM per server, which is
   * how this is run, the two readings agree.
   */
  managedBy(gmId: string): StoredUser[] {
    return [...this.users.values()].filter(
      (user) => user.role === 'player' && (user.createdBy === null || user.createdBy === gmId),
    );
  }

  isManagedBy(userId: string, gmId: string): boolean {
    const user = this.users.get(userId);
    return user !== undefined && user.role === 'player' && (user.createdBy === null || user.createdBy === gmId);
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
   * New accounts always start `mustChangePassword: true` — a GM-set password is
   * temporary by design. Returns null if the username is already taken.
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
  ): Promise<User | null> {
    if (this.findByUsername(username) !== null) return null;
    const id = `u-${randomBytes(8).toString('hex')}`;
    const user: StoredUser = {
      id,
      username,
      role,
      mustChangePassword: true,
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
