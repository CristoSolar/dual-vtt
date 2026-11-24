import { z } from 'zod';

/**
 * A character's portrait: what the map token, the library card, the sheet header
 * and the GM's party list draw. Null on a sheet means "my ancestry's art", which
 * is also what every character created before avatars existed gets.
 *
 * Every variant names its picture by an id or a server path, never an arbitrary
 * URL, so a sheet cannot make other players' browsers fetch from somewhere else.
 */

const ArtIdSchema = z.string().regex(/^[a-z0-9-]{1,40}$/);

/** Where an uploaded avatar lives: a file `POST /uploads/avatar` stored, nothing else. */
export const AVATAR_UPLOAD_URL = /^\/uploads\/[0-9a-f]{24}\.(png|jpg|gif|webp)$/;

/**
 * How an uploaded picture sits in its circle: `x`/`y` are the CSS
 * `object-position` percentages and `zoom` scales it about that point.
 */
export const AvatarCropSchema = z
  .object({
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    zoom: z.number().min(1).max(4),
  })
  .strict();
export type AvatarCrop = z.infer<typeof AvatarCropSchema>;

export const AvatarSchema = z.discriminatedUnion('kind', [
  /** The ancestry art the wizard shows; for a mixed heritage, either of the two. */
  z.object({ kind: z.literal('ancestry'), ancestryId: ArtIdSchema }).strict(),
  /** A portrait from `public/images/avatars/<id>.webp`. */
  z.object({ kind: z.literal('gallery'), id: ArtIdSchema }).strict(),
  z
    .object({
      kind: z.literal('upload'),
      url: z.string().regex(AVATAR_UPLOAD_URL),
      crop: AvatarCropSchema.optional(),
    })
    .strict(),
]);
export type Avatar = z.infer<typeof AvatarSchema>;
