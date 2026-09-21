import { randomBytes } from 'node:crypto';

/** How long a login token stays valid. Refreshed on every use. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface Session {
  userId: string;
  expiresAt: number;
}

/**
 * Maps a login token to the account it belongs to. In-memory only, unlike room
 * seat tokens: a server restart signing everyone out is an acceptable cost for
 * how rarely this server restarts, and it keeps this phase's trust boundary simple.
 *
 * Tokens expire, and changing a password drops every token for that account, so a
 * stolen token cannot outlive the credential it was issued against.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly ttlMs: number = SESSION_TTL_MS) {}

  create(userId: string, now = Date.now()): string {
    // Logins are rare; sweeping here keeps abandoned tokens from accumulating
    // without needing a timer.
    this.prune(now);
    const token = randomBytes(24).toString('hex');
    this.sessions.set(token, { userId, expiresAt: now + this.ttlMs });
    return token;
  }

  resolve(token: string, now = Date.now()): string | null {
    const session = this.sessions.get(token);
    if (session === undefined) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(token);
      return null;
    }
    session.expiresAt = now + this.ttlMs;
    return session.userId;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }

  /**
   * Every token for one account. Called whenever that account's password changes.
   * `keepToken` spares the caller's own token, so someone changing their own
   * password is not signed out by the change.
   */
  destroyAllFor(userId: string, keepToken?: string): void {
    for (const [token, session] of this.sessions) {
      if (session.userId === userId && token !== keepToken) this.sessions.delete(token);
    }
  }

  private prune(now: number): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(token);
    }
  }
}
