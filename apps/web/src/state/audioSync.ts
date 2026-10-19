import type { AudioState } from '@daggerheart/protocol';

type Playing = NonNullable<AudioState['playing']>;

/**
 * Where in the track this client should be, in seconds, given the server's start
 * time and this clock. Null when a track that does not loop has already ended, so
 * a late joiner hears silence rather than the last moment replayed.
 *
 * A clock running behind the server's would put the start in the future; that
 * plays from the top instead of waiting. An unknown duration (no metadata yet)
 * cannot wrap or end, so it gives the raw elapsed time.
 */
export function offsetSeconds(playing: Playing, nowMs: number, durationSec: number): number | null {
  const elapsed = Math.max(0, (nowMs - playing.startedAt) / 1000);
  if (!Number.isFinite(durationSec) || durationSec <= 0) return elapsed;
  if (playing.loop) return elapsed % durationSec;
  return elapsed < durationSec ? elapsed : null;
}
