import { z } from 'zod';

import { RoomEventSchema, type RoomEvent } from './events.js';
import { JournalEntrySchema } from './journal.js';
import { CampaignStorySchema, PrepAdversarySchema } from './prep.js';

/**
 * Where a campaign stands. Players may enter only an `'active'` one; a paused or
 * finished campaign seats its GM alone, who can still prepare or review it.
 */
export const CampaignStatusSchema = z.enum(['active', 'paused', 'finished']);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

/**
 * What a client sees about a campaign outside the live room — no full `RoomState`
 * here, that only travels over the socket once a client has joined.
 */
export const CampaignSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ownerId: z.string().min(1),
  ownerUsername: z.string().min(1),
  /** Player account ids the GM has added. Does not include the owner. */
  memberIds: z.array(z.string().min(1)),
  /**
   * Player account ids invited but not yet accepted. Only the owner is told who
   * they are; everyone else receives an empty list. Defaulted so a summary from an
   * older server still reads.
   */
  invitedIds: z.array(z.string().min(1)).default([]),
  /** Defaulted so a summary from an older server still reads. */
  status: CampaignStatusSchema.default('active'),
});
export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

export const CreateCampaignRequestSchema = z.object({
  name: z.string().min(1).max(60),
});
export type CreateCampaignRequest = z.infer<typeof CreateCampaignRequestSchema>;

export const AddPlayerRequestSchema = z.object({
  username: z.string().min(1),
});
export type AddPlayerRequest = z.infer<typeof AddPlayerRequestSchema>;

/** The GM invites a player account by username; it joins only once it accepts. */
export const InvitePlayerRequestSchema = AddPlayerRequestSchema;
export type InvitePlayerRequest = AddPlayerRequest;

/**
 * `GET /campaigns`: the campaigns this account owns or belongs to, and those it
 * has been invited to and has not answered yet.
 */
export const CampaignListSchema = z.object({
  member: z.array(CampaignSummarySchema),
  invited: z.array(CampaignSummarySchema),
});
export type CampaignList = z.infer<typeof CampaignListSchema>;

/** `PATCH /campaigns/:id`: the GM renames the campaign, changes its status, or both. */
export const UpdateCampaignRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    status: CampaignStatusSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.status !== undefined, { message: 'nothing to update' });
export type UpdateCampaignRequest = z.infer<typeof UpdateCampaignRequestSchema>;

/** A member as the GM's campaign page lists them, with the character they play. */
export const CampaignMemberSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  character: z
    .object({ name: z.string().nullable(), classId: z.string().min(1), level: z.number().int().positive() })
    .nullable(),
});
export type CampaignMember = z.infer<typeof CampaignMemberSchema>;

/**
 * `GET /campaigns/:id`, GM only: what the campaign page shows outside the live
 * table. Three GM slices of the room travel here — the story, the prep list and
 * the journal — never the room itself.
 */
export const CampaignDetailSchema = z.object({
  campaign: CampaignSummarySchema,
  members: z.array(CampaignMemberSchema),
  invited: z.array(z.object({ id: z.string().min(1), username: z.string().min(1) })),
  story: CampaignStorySchema,
  prepAdversaries: z.array(PrepAdversarySchema),
  journal: z.array(JournalEntrySchema),
});
export type CampaignDetail = z.infer<typeof CampaignDetailSchema>;

/** The intents the campaign page may send over HTTP; everything else needs the table. */
export const CAMPAIGN_PREP_EVENT_TYPES = [
  'setStory',
  'upsertPrepAdversary',
  'addPrepAdversary',
  'removePrepAdversary',
  'upsertJournalEntry',
  'removeJournalEntry',
] as const;
export type CampaignPrepEvent = Extract<RoomEvent, { type: (typeof CAMPAIGN_PREP_EVENT_TYPES)[number] }>;

/** `POST /campaigns/:id/prep`: one prep intent, run through `applyRoomEvent`. */
export const CampaignPrepEventSchema = RoomEventSchema.refine(
  (event): event is CampaignPrepEvent =>
    (CAMPAIGN_PREP_EVENT_TYPES as readonly string[]).includes(event.type),
  { message: 'not a campaign prep intent' },
) as unknown as z.ZodType<CampaignPrepEvent, z.ZodTypeDef, unknown>;
