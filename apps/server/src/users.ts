import { randomBytes } from 'node:crypto';

import type { User, UserRole } from '@daggerheart/protocol';

import { hashPassword, verifyPasswordHash } from './passwords.js';

/** The server-only shape: everything `User` has, plus the hash. Never sent to a client. */
export interface StoredUser extends User {
  passwordHash: string;
}

function toPublic(user: StoredUser): User {
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

  get size(): number {
    return this.users.size;
  }

  findByUsername(username: string): StoredUser | null {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    return null;
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

  /** New accounts always start `mustChangePassword: true` — a GM-set password is temporary by design. */
  async createUser(username: string, password: string, role: UserRole): Promise<User> {
    const id = `u-${randomBytes(8).toString('hex')}`;
    const passwordHash = await hashPassword(password);
    const user: StoredUser = { id, username, role, mustChangePassword: true, passwordHash };
    this.users.set(id, user);
    return toPublic(user);
  }

  async verifyLogin(username: string, password: string): Promise<User | null> {
    const stored = this.findByUsername(username);
    if (stored === null) return null;
    const ok = await verifyPasswordHash(password, stored.passwordHash);
    return ok ? toPublic(stored) : null;
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
