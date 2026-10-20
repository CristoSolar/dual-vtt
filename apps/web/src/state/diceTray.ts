import {
  DICE_SIDES,
  MAX_DICE_PER_GROUP,
  type DieSides,
  type RoomEvent,
  type Visibility,
} from '@daggerheart/protocol';

/** How many of each die are in the tray. A size that is not there has no key. */
export type TrayCounts = Readonly<Partial<Record<DieSides, number>>>;

/** Adds one die of a size, up to the most the server accepts. */
export function addDie(tray: TrayCounts, sides: DieSides): TrayCounts {
  return { ...tray, [sides]: Math.min(MAX_DICE_PER_GROUP, (tray[sides] ?? 0) + 1) };
}

/** Takes one die of a size away; a size that reaches zero leaves the tray. */
export function removeDie(tray: TrayCounts, sides: DieSides): TrayCounts {
  const count = (tray[sides] ?? 0) - 1;
  const { [sides]: _removed, ...rest } = tray;
  return count > 0 ? { ...rest, [sides]: count } : rest;
}

/** The tray's dice as the intent lists them, smallest die first. */
export function trayDice(tray: TrayCounts): { sides: DieSides; count: number }[] {
  return DICE_SIDES.flatMap((sides) => {
    const count = tray[sides] ?? 0;
    return count > 0 ? [{ sides, count }] : [];
  });
}

/** A typed modifier, kept to the whole numbers the server takes. */
export function clampModifier(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-99, Math.min(99, Math.trunc(value)));
}

/** The intent that rolls the tray, or null when there is nothing in it. */
export function trayIntent(tray: TrayCounts, modifier: number, visibility: Visibility): RoomEvent | null {
  const dice = trayDice(tray);
  if (dice.length === 0) return null;
  return { type: 'rollDice', dice, modifier: clampModifier(modifier), visibility };
}
