import { z } from 'zod';

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
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const LoginResponseSchema = z.object({
  token: z.string().min(1),
  user: UserSchema,
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const CreatePlayerRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  newPassword: z.string().min(1),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;
