import { z } from 'zod';

/**
 * The GM's notes on what the campaign is about: a one-line pitch and the story so
 * far. GM-only — `roomForRole('player')` hands players an empty one.
 */
export const CampaignStorySchema = z.object({
  pitch: z.string().max(500),
  body: z.string().max(50_000),
});
export type CampaignStory = z.infer<typeof CampaignStorySchema>;

/** The most of one adversary a prep row holds. */
export const MAX_PREP_QUANTITY = 20;

/**
 * An adversary the GM plans to use: which stat block, how many, and why. Preparing
 * one fields nothing; the GM panel turns it into `addAdversary` intents.
 */
export const PrepAdversarySchema = z.object({
  id: z.string().min(1).max(64),
  /** Id into `srd-data`'s adversaries. */
  adversaryId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(MAX_PREP_QUANTITY),
  note: z.string().max(300),
});
export type PrepAdversary = z.infer<typeof PrepAdversarySchema>;

/** How many entries a campaign's prep list holds. */
export const MAX_PREP_ADVERSARIES = 50;
