import { z } from 'zod';

import { CampaignStatusSchema } from './campaign.js';

export const UserRoleSchema = z.enum(['gm', 'player']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * What a client is ever allowed to see about an account. The password hash lives
 * only in the server's own storage and never reaches this shape.
 */
export const UserSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  role: UserRoleSchema,
  mustChangePassword: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  token: z.string().min(1),
  user: UserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

/**
 * The shortest password the server will store. It is checked here rather than in
 * the browser alone, because the browser is not a trust boundary. Logging in is
 * exempt: an account created before this rule still has to be able to sign in and
 * change its password.
 */
export const MIN_PASSWORD_LENGTH = 8;

export const CreatePlayerRequestSchema = z.object({
  /** Trimmed here; the server also compares usernames without case. */
  username: z.string().trim().min(1).max(40),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

/**
 * A row of the GM's "Mis jugadores": a player account they manage, the GM's own
 * campaigns it belongs to or is invited to, and when it last signed in. Never a
 * password hash, and never another GM's campaigns.
 */
export const ManagedPlayerSchema = z.object({
  id: z.string().min(1),
  username: z.string().min(1),
  mustChangePassword: z.boolean(),
  campaigns: z.array(
    z.object({ id: z.string().min(1), name: z.string().min(1), status: CampaignStatusSchema }),
  ),
  invitedTo: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
  lastLoginAt: z.number().nullable(),
});
export type ManagedPlayer = z.infer<typeof ManagedPlayerSchema>;

/**
 * First-run setup (desktop app): while the server has no GM account at all, `GET
 * /setup` says so and `POST /setup` creates the first one — once. The password is
 * the GM's own choice, so it is not flagged for change. The reply is a
 * `LoginResponse`, signing the new GM straight in.
 */
export const SetupStatusSchema = z.object({ needsSetup: z.boolean() });
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

export const SetupRequestSchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});
export type SetupRequest = z.infer<typeof SetupRequestSchema>;
