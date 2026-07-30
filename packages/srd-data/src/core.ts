import { z } from 'zod';

/** The six character traits (SRD p.5, "Assign Character Traits"). */
export const TraitSchema = z.enum([
  'agility',
  'strength',
  'finesse',
  'instinct',
  'presence',
  'knowledge',
]);
export type Trait = z.infer<typeof TraitSchema>;

/** Range bands (SRD p.40, "Maps, Range & Movement"). */
export const RangeSchema = z.enum(['melee', 'veryClose', 'close', 'far', 'veryFar']);
export type Range = z.infer<typeof RangeSchema>;

/** physical (phy) or magic (mag) — SRD p.39, "Damage Types". */
export const DamageTypeSchema = z.enum(['physical', 'magic']);
export type DamageType = z.infer<typeof DamageTypeSchema>;

/** Tier 1 = level 1, Tier 2 = levels 2-4, Tier 3 = levels 5-7, Tier 4 = levels 8-10. */
export const TierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type Tier = z.infer<typeof TierSchema>;

export const DieSizeSchema = z.union([
  z.literal(4),
  z.literal(6),
  z.literal(8),
  z.literal(10),
  z.literal(12),
  z.literal(20),
]);
export type DieSize = z.infer<typeof DieSizeSchema>;

/**
 * Structured dice expression. `count` is the number of dice printed on the item;
 * for weapons this is the base before Proficiency multiplies it.
 */
export const DiceSchema = z.object({
  count: z.number().int().nonnegative(),
  die: DieSizeSchema,
  modifier: z.number().int(),
});
export type Dice = z.infer<typeof DiceSchema>;

/** Renders a Dice as SRD notation, e.g. `{count:1,die:8,modifier:3}` -> "1d8+3". */
export function formatDice({ count, die, modifier }: Dice): string {
  const base = `${count}d${die}`;
  if (modifier === 0) return base;
  return `${base}${modifier > 0 ? '+' : '−'}${Math.abs(modifier)}`;
}

/** Renders a flat modifier, e.g. 2 -> "+2", -1 -> "−1", 0 -> "+0". */
export function formatModifier(modifier: number): string {
  return modifier < 0 ? `−${Math.abs(modifier)}` : `+${modifier}`;
}

/** Major/Severe damage thresholds. Minor is "below Major"; there is no stored value. */
export const ThresholdsSchema = z.object({
  major: z.number().int().positive(),
  severe: z.number().int().positive(),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

export const DomainIdSchema = z.enum([
  'arcana',
  'blade',
  'bone',
  'codex',
  'grace',
  'midnight',
  'sage',
  'splendor',
  'valor',
]);
export type DomainId = z.infer<typeof DomainIdSchema>;

export const ClassIdSchema = z.enum([
  'bard',
  'druid',
  'guardian',
  'ranger',
  'rogue',
  'seraph',
  'sorcerer',
  'warrior',
  'wizard',
]);
export type ClassId = z.infer<typeof ClassIdSchema>;

/** A named feature with its SRD text preserved verbatim. */
export const FeatureSchema = z.object({
  name: z.string().min(1),
  text: z.string().min(1),
});
export type Feature = z.infer<typeof FeatureSchema>;
