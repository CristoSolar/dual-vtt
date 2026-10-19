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
      const die = entry.roll.die ?? damageDie(entry.roll);
      if (rolls.length === 0 || die === null) return null;
      return [{ notation: `${rolls.length}d${die}@${rolls.join(',')}`, color: 'neutral' }];
    }
    case 'fate':
    case 'message':
    case 'table':
      return null;
  }
}

/**
 * Whether a broadcast has anything to throw. A chat line, table roll or region
 * notice must not replace the dice still on screen: the overlay's timer belongs to
 * the roll it is showing, and a dice-less roll would cancel it and never clear.
 */
export function hasDice(entries: readonly RollEntry[]): boolean {
  return entries.some((entry) => notationFor(entry) !== null);
}

/**
 * Entries logged before damage kept its die size have only the faces. A critical
 * adds the dice's maximum, which gives the size back exactly; otherwise the
 * smallest standard die that could have shown every face stands in for it, and
 * a face no standard die has means nothing is drawn.
 */
function damageDie(roll: { rolls: readonly number[]; criticalBonus: number }): number | null {
  if (roll.criticalBonus > 0 && roll.criticalBonus % roll.rolls.length === 0) {
    return roll.criticalBonus / roll.rolls.length;
  }
  const highest = Math.max(...roll.rolls);
  return STANDARD_DICE.find((die) => die >= highest) ?? null;
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

/** A broadcast's entries, as the dice overlay throws them. */
export interface DiceRoll {
  id: string;
  entries: RollEntry[];
}

/**
 * How far apart, by the server's clock, two of one roller's broadcasts can be and
 * still be one action. An attack is two intents — the action roll, then its
 * damage — so its dice arrive as two broadcasts, often in the same render.
 */
const BURST_MS = 1000;

/**
 * The roll to throw once `next` arrives. A follow-up to the roll still on the table
 * joins it, so an attack's damage die lands beside its Hope and Fear dice instead
 * of replacing them before they were ever drawn.
 */
export function joinBurst(previous: DiceRoll | null, next: DiceRoll): DiceRoll {
  const last = previous?.entries.at(-1);
  const first = next.entries[0];
  if (previous === null || last === undefined || first === undefined) return next;
  const gap = first.at - last.at;
  if (first.by !== last.by || gap < 0 || gap > BURST_MS) return next;
  return { id: `${previous.id}-${next.id}`, entries: [...previous.entries, ...next.entries] };
}

/**
 * Thrown when 3D dice are switched on before anything was rolled, so the switch
 * visibly does something. Display only: it is never logged or sent.
 */
export function previewRoll(): DiceRoll {
  return {
    id: 'preview',
    entries: [
      {
        kind: 'duality',
        id: 'preview',
        at: 0,
        by: 'preview',
        label: 'preview',
        roll: {
          hope: 8,
          fear: 5,
          total: 13,
          modifiers: 0,
          critical: false,
          withHope: true,
          advantageRoll: null,
          disadvantageRoll: null,
        },
        difficulty: 10,
        outcome: 'successHope',
        experiences: [],
        reaction: false,
        target: null,
      },
    ],
  };
}
