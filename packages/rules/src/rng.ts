/**
 * Injectable randomness. Must return a float in [0, 1) like `Math.random`.
 * Every function in this package that rolls dice takes one, so tests are
 * deterministic and no function reads global state.
 */
export type Rng = () => number;

/** Rolls one die with `sides` faces, returning 1..sides. */
export function rollDie(sides: number, rng: Rng): number {
  return Math.floor(rng() * sides) + 1;
}

/** Rolls `count` dice with `sides` faces and returns each result. */
export function rollDice(count: number, sides: number, rng: Rng): number[] {
  const results: number[] = [];
  for (let i = 0; i < count; i++) results.push(rollDie(sides, rng));
  return results;
}

/**
 * A deterministic RNG for tests and replayable sessions: a 32-bit
 * xorshift-based generator seeded by an integer.
 */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * An RNG that yields the given faces in order, then throws if drained. Lets a test
 * say "roll a 7, then a 3".
 *
 * A face's mapping depends on the die it is read with, so pass `[face, sides]` for
 * any roll that isn't `defaultSides`. `scriptedRng([7, 3])` scripts two d12s;
 * `scriptedRng([7, [4, 6]])` scripts a d12 then a d6 showing 4.
 */
export function scriptedRng(
  rolls: ReadonlyArray<number | readonly [face: number, sides: number]>,
  defaultSides = 12,
): Rng {
  let i = 0;
  return () => {
    const next = rolls[i++];
    if (next === undefined) throw new Error('scriptedRng exhausted');
    const [face, sides] = typeof next === 'number' ? [next, defaultSides] : next;
    // Land strictly inside the bucket that rollDie maps to `face`.
    return (face - 0.5) / sides;
  };
}
