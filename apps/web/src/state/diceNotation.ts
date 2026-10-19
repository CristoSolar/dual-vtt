import type { RollEntry } from './rollLog.js';

/** Which face colour a thrown die wears: Hope gold, Fear violet, or plain. */
export type DiceColor = 'hope' | 'fear' | 'neutral';

export interface DiceThrow {
  /** Dice notation with the faces forced, e.g. `2d8@3,5`. */
  notation: string;
  color: DiceColor;
}

/** Die sizes the overlay can draw, smallest first. */
const STANDARD_DICE = [4, 6, 8, 10, 12, 20] as const;

/**
 * The dice to throw on screen for a roll the server already made. Every face is
 * forced to the logged result, so the animation only ever shows what happened —
 * nothing here rolls. Null for an entry with no dice to show.
 */
export function notationFor(entry: RollEntry): DiceThrow[] | null {
  switch (entry.kind) {
    case 'duality': {
      const { hope, fear, advantageRoll, disadvantageRoll } = entry.roll;
      const dice: DiceThrow[] = [
        { notation: `1d12@${hope}`, color: 'hope' },
        { notation: `1d12@${fear}`, color: 'fear' },
      ];
      const d6 = advantageRoll ?? disadvantageRoll;
      if (d6 !== null) dice.push({ notation: `1d6@${d6}`, color: 'neutral' });
      return dice;
    }
    case 'attack':
      return [{ notation: `1d20@${entry.roll.die}`, color: 'neutral' }];
    case 'damage': {
      const { rolls } = entry.roll;
      if (rolls.length === 0) return null;
      return [{ notation: `${rolls.length}d${damageDie(entry.roll)}@${rolls.join(',')}`, color: 'neutral' }];
    }
    case 'fate':
    case 'message':
      return null;
  }
}

/**
 * The log keeps a damage roll's faces but not its die size. A critical adds the
 * dice's maximum, which gives the size back exactly; otherwise the smallest
 * standard die that could have shown every face stands in for it.
 */
function damageDie(roll: { rolls: readonly number[]; criticalBonus: number }): number {
  if (roll.criticalBonus > 0 && roll.criticalBonus % roll.rolls.length === 0) {
    return roll.criticalBonus / roll.rolls.length;
  }
  const highest = Math.max(...roll.rolls);
  return STANDARD_DICE.find((die) => die >= highest) ?? highest;
}

/**
 * One throw per colour, since a dice box paints every die it throws alike. The
 * sets and their forced faces are joined in the same order, so each face still
 * lands on its own die: `1d6@5` + `2d8@3,2` → `1d6+2d8@5,3,2`.
 */
export function groupByColor(throws: readonly DiceThrow[]): DiceThrow[] {
  const groups = new Map<DiceColor, { sets: string[]; faces: string[] }>();
  for (const { notation, color } of throws) {
    const [sets = '', faces = ''] = notation.split('@');
    const group = groups.get(color) ?? { sets: [], faces: [] };
    group.sets.push(sets);
    group.faces.push(faces);
    groups.set(color, group);
  }
  return [...groups].map(([color, { sets, faces }]) => ({
    notation: `${sets.join('+')}@${faces.join(',')}`,
    color,
  }));
}
