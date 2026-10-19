import { z } from 'zod';

/** One uploaded track on the GM's playlist. `url` is the server path it plays from. */
export const TrackSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  url: z.string().min(1).max(512),
});
export type Track = z.infer<typeof TrackSchema>;

/** How many tracks a campaign's playlist holds. */
export const MAX_TRACKS = 50;

/**
 * The playlist and what is playing. Every client derives its position from
 * `startedAt`, a server timestamp, so a player who joins mid-song hears the same
 * moment as everybody else. Public: players need `playing` to hear anything.
 */
export const AudioStateSchema = z.object({
  tracks: z.array(TrackSchema).max(MAX_TRACKS),
  playing: z
    .object({
      trackId: z.string().min(1).max(64),
      startedAt: z.number(),
      loop: z.boolean(),
      volume: z.number().min(0).max(1),
    })
    .nullable(),
});
export type AudioState = z.infer<typeof AudioStateSchema>;
