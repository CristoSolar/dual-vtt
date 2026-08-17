import { z } from 'zod';

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
