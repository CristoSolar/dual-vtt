import { describe, expect, it } from 'vitest';

import { DragThrottle, type DragMove } from '../src/state/dragCommit.js';

/** A fake clock, so throttling is tested without waiting. */
function clock(start = 0) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

describe('drag throttling', () => {
  it('emits exactly one committed move per release, however many frames a drag has', () => {
    const time = clock();
    const throttle = new DragThrottle({ intervalMs: 100, now: time.now });
    const sent: DragMove[] = [];

    // Sixty frames of dragging, a frame every 16ms, as a real pointer would.
    for (let frame = 0; frame < 60; frame++) {
      const preview = throttle.move(frame, frame * 2);
      if (preview !== null) sent.push(preview);
      time.advance(16);
    }
    sent.push(throttle.end(60, 120));

    const commits = sent.filter((move) => move.commit);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toEqual({ x: 60, y: 120, commit: true });
  });

  it('throttles the previews rather than sending one per frame', () => {
    const time = clock();
    const throttle = new DragThrottle({ intervalMs: 100, now: time.now });
    let previews = 0;

    // One second of dragging at 60fps.
    for (let frame = 0; frame < 60; frame++) {
      if (throttle.move(frame, frame) !== null) previews += 1;
      time.advance(16);
    }

    // At 100ms apart, a second of dragging is about ten previews, not sixty.
    expect(previews).toBeLessThanOrEqual(11);
    expect(previews).toBeGreaterThan(1);
  });

  it('sends the first move immediately so the table sees the drag start', () => {
    const throttle = new DragThrottle({ intervalMs: 100, now: clock().now });
    expect(throttle.move(5, 5)).toEqual({ x: 5, y: 5, commit: false });
  });

  it('suppresses previews inside the throttle window', () => {
    const time = clock();
    const throttle = new DragThrottle({ intervalMs: 100, now: time.now });

    expect(throttle.move(1, 1)).not.toBeNull();
    time.advance(50);
    expect(throttle.move(2, 2)).toBeNull();
    time.advance(60); // 110ms since the last send
    expect(throttle.move(3, 3)).not.toBeNull();
  });

  it('commits even when the drag was too short to emit any preview', () => {
    const time = clock();
    const throttle = new DragThrottle({ intervalMs: 1000, now: time.now });

    const preview = throttle.move(10, 10);
    time.advance(20);
    const second = throttle.move(12, 12);
    const commit = throttle.end(12, 12);

    // The first move sends, the second is throttled, and the release still commits.
    expect(preview).not.toBeNull();
    expect(second).toBeNull();
    expect(commit).toEqual({ x: 12, y: 12, commit: true });
  });

  it('commits at the last known position when the release gives none', () => {
    const throttle = new DragThrottle({ now: clock().now });
    throttle.move(7, 9);
    expect(throttle.end()).toEqual({ x: 7, y: 9, commit: true });
  });

  it('starts clean for the next drag', () => {
    const time = clock();
    const throttle = new DragThrottle({ intervalMs: 100, now: time.now });

    throttle.move(1, 1);
    throttle.end(1, 1);

    // A fresh drag emits its first preview straight away, not after the interval.
    expect(throttle.move(2, 2)).toEqual({ x: 2, y: 2, commit: false });
  });

  it('counts one commit per drag across several drags', () => {
    const time = clock();
    const throttle = new DragThrottle({ intervalMs: 100, now: time.now });
    const commits: DragMove[] = [];

    for (let drag = 0; drag < 3; drag++) {
      for (let frame = 0; frame < 20; frame++) {
        throttle.move(frame, frame);
        time.advance(16);
      }
      commits.push(throttle.end(20, 20));
    }

    expect(commits).toHaveLength(3);
    expect(commits.every((move) => move.commit)).toBe(true);
  });
});
