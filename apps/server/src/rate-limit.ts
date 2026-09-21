/**
 * A fixed-window attempt counter, used to slow password guessing on `/login`.
 *
 * ponytail: in-memory and per-process, which is all a single self-hosted server
 * needs. Move it behind a shared store only if this ever runs more than one node.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** True when this key has spent its attempts and should be refused. */
  isLimited(key: string, now = Date.now()): boolean {
    const window = this.windows.get(key);
    if (window === undefined) return false;
    if (window.resetAt <= now) {
      this.windows.delete(key);
      return false;
    }
    return window.count >= this.limit;
  }

  /** Counts one failed attempt. */
  fail(key: string, now = Date.now()): void {
    const window = this.windows.get(key);
    if (window === undefined || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    window.count += 1;
  }

  /** Clears the count. Called on a successful login. */
  succeed(key: string): void {
    this.windows.delete(key);
  }

  /** Forgets every key. For tests, which must not inherit a lockout. */
  clear(): void {
    this.windows.clear();
  }
}
