import { randomBytes } from 'node:crypto';

/**
 * Maps a login token to the account it belongs to. In-memory only, unlike room
 * seat tokens: a server restart signing everyone out is an acceptable cost for
 * how rarely this server restarts, and it keeps this phase's trust boundary simple.
 */
export class SessionStore {
  private readonly sessions = new Map<string, string>();

  create(userId: string): string {
    const token = randomBytes(24).toString('hex');
    this.sessions.set(token, userId);
    return token;
  }

  resolve(token: string): string | null {
    return this.sessions.get(token) ?? null;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }
}
