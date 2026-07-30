/**
 * Throttling for token drags.
 *
 * A drag fires a pointer event every frame. Sending each one would flood the socket,
 * so intermediate positions are throttled and exactly one committed move is sent when
 * the drag is released. The commit is what the server treats as final.
 *
 * Pure and clock-injected so it can be tested without a canvas or a timer.
 */

export interface DragMove {
  x: number;
  y: number;
  /** True only for the final move of a drag. */
  commit: boolean;
}

export interface DragThrottleOptions {
  /** Minimum milliseconds between intermediate previews. */
  intervalMs?: number;
  now?: () => number;
}

/**
 * Tracks one token's drag. `move` returns the preview to send, or null to skip;
 * `end` always returns exactly one committed move.
 */
export class DragThrottle {
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private latest: { x: number; y: number } | null = null;
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor({ intervalMs = 100, now = () => Date.now() }: DragThrottleOptions = {}) {
    this.intervalMs = intervalMs;
    this.now = now;
  }

  /** Records a position mid-drag, returning a preview to send if enough time passed. */
  move(x: number, y: number): DragMove | null {
    this.latest = { x, y };
    const at = this.now();
    if (at - this.lastSentAt < this.intervalMs) return null;
    this.lastSentAt = at;
    return { x, y, commit: false };
  }

  /**
   * Ends the drag. Always returns a single committed move at the final position,
   * even if the pointer never moved far enough to emit a preview.
   */
  end(x?: number, y?: number): DragMove {
    const final = x !== undefined && y !== undefined ? { x, y } : (this.latest ?? { x: 0, y: 0 });
    this.reset();
    return { ...final, commit: true };
  }

  reset(): void {
    this.lastSentAt = Number.NEGATIVE_INFINITY;
    this.latest = null;
  }
}
