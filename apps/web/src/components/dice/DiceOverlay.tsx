import type DiceBox from '@3d-dice/dice-box-threejs';
import type { DiceColorset } from '@3d-dice/dice-box-threejs';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { diceTimings, FADE_MS, groupByColor, notationFor, type DiceColor } from '../../state/diceNotation.js';
import type { RollEntry } from '../../state/rollLog.js';
import { token } from '../../styles/canvasTokens.js';

/** The longest a throw is waited on before its dice start to linger anyway. */
const SETTLE_CAP_MS = 6000;

const COLORS: readonly DiceColor[] = ['hope', 'fear', 'neutral'];

/** Face and ink per colour, read off the same tokens the sheet's Hope and Fear use. */
function colorset(color: DiceColor): DiceColorset {
  const [background, foreground, outline] =
    color === 'hope'
      ? [token('--c-hope-fill'), token('--c-hope-ink'), token('--c-hope-edge')]
      : color === 'fear'
        ? [token('--c-fear-fill'), token('--c-fear-ink'), token('--c-fear-edge')]
        : [token('--c-surface-3'), token('--c-text'), token('--c-line')];
  return { name: `dh-${color}`, background, foreground, outline, texture: 'none', material: 'none' };
}

/**
 * Throws a roll's dice across the screen. The server has already rolled them: every
 * face is forced to the logged result, so this is display only and never feeds back
 * into anything. The library is fetched on the first roll, not with the app.
 *
 * A dice box paints all of its dice alike, so each colour gets its own box layered
 * over the others.
 */
export function DiceOverlay({ roll }: { roll: { id: string; entries: readonly RollEntry[] } | null }) {
  const boxes = useRef(new Map<DiceColor, Promise<DiceBox>>());
  const [phase, setPhase] = useState<'hidden' | 'shown' | 'fading'>('hidden');

  const boxFor = (color: DiceColor): Promise<DiceBox> => {
    const existing = boxes.current.get(color);
    if (existing !== undefined) return existing;
    const created = import('@3d-dice/dice-box-threejs').then(async ({ default: Box }) => {
      const box = new Box(`#dice-layer-${color}`, { sounds: false, theme_customColorset: colorset(color) });
      await box.initialize();
      return box;
    });
    // A failed load (offline chunk, no WebGL) is retried on the next roll rather
    // than cached; the toast still reports the result either way.
    created.catch(() => boxes.current.delete(color));
    boxes.current.set(color, created);
    return created;
  };

  useEffect(() => {
    if (roll === null) return;
    const throws = groupByColor(roll.entries.flatMap((entry) => notationFor(entry) ?? []));
    if (throws.length === 0) return;

    let cancelled = false;
    const timers: number[] = [];
    const later = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms));
    for (const color of COLORS) {
      if (throws.some((t) => t.color === color)) continue;
      void boxes.current.get(color)?.then((box) => box.clearDice(), () => {});
    }
    // The table shows once the dice are actually thrown. The first roll fetches
    // the library, which over a slow link can take longer than the dice stay up:
    // timed from the broadcast, they landed unseen.
    void Promise.allSettled(
      throws.map(({ color, notation }) => boxFor(color).then((box) => ({ box, notation }))),
    ).then((settled) => {
      if (cancelled) return;
      const ready = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      // A roll that lands mid-fade takes the dice straight back to full opacity.
      setPhase(ready.length > 0 ? 'shown' : 'hidden');
      if (ready.length === 0) return;
      const landed = Promise.allSettled(ready.map(({ box, notation }) => box.roll(notation)));
      // The dice linger once they settle; a throw that never reports settling
      // (a backgrounded tab pauses the animation) still clears eventually.
      const settledOrCapped = Promise.race([
        landed,
        new Promise<void>((resolve) => later(SETTLE_CAP_MS, resolve)),
      ]);
      void settledOrCapped.then(() => {
        if (cancelled) return;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const { lingerMs, fadeMs } = diceTimings(reducedMotion);
        later(lingerMs, () => {
          setPhase('fading');
          later(fadeMs, () => {
            setPhase('hidden');
            for (const box of boxes.current.values()) void box.then((b) => b.clearDice(), () => {});
          });
        });
      });
    });
    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
    // `boxFor` only reads a ref. Every broadcast is a new object, so `roll`
    // changes exactly when there is something new to throw.
  }, [roll]);

  useEffect(() => {
    const owned = boxes.current;
    return () => {
      for (const box of owned.values()) {
        void box.then((b) => {
          b.clearDice();
          b.renderer.dispose();
          // The library never removes its window resize listener, which keeps
          // the GL context alive after dispose; drop the context explicitly.
          b.renderer.forceContextLoss();
        }, () => {});
      }
      owned.clear();
    };
  }, []);

  return (
    <div
      className={
        phase === 'shown'
          ? 'dice-overlay dice-overlay--visible'
          : phase === 'fading'
            ? 'dice-overlay dice-overlay--fading'
            : 'dice-overlay'
      }
      // The fade's duration lives in JS (`FADE_MS`); the CSS transition reads it
      // from this custom property instead of repeating the number.
      style={{ '--dice-fade-ms': `${FADE_MS}ms` } as CSSProperties}
      aria-hidden="true"
    >
      {COLORS.map((color) => (
        <div key={color} id={`dice-layer-${color}`} className="dice-overlay-layer" />
      ))}
    </div>
  );
}
