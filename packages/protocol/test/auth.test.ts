import { describe, expect, it } from 'vitest';

import {
  ChangePasswordRequestSchema,
  CreatePlayerRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  ResetPasswordRequestSchema,
  UserSchema,
} from '../src/index.js';

describe('auth schemas', () => {
  it('accepts a well-formed user', () => {
    const user = { id: 'u-1', username: 'alex', role: 'player', mustChangePassword: false };
    expect(UserSchema.parse(user)).toEqual(user);
  });

  it('rejects a user with an unknown role', () => {
    expect(
      UserSchema.safeParse({ id: 'u-1', username: 'alex', role: 'wizard', mustChangePassword: false })
        .success,
    ).toBe(false);
  });

  it('rejects an empty username or password on login', () => {
    expect(LoginRequestSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ username: 'x', password: '' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ username: 'gm', password: 'gm' }).success).toBe(true);
  });

  it('accepts a login response carrying a token and a user', () => {
    const response = {
      token: 'abc123',
      user: { id: 'u-1', username: 'alex', role: 'gm', mustChangePassword: true },
    };
    expect(LoginResponseSchema.parse(response)).toEqual(response);
  });

  it('validates create-player, change-password, and reset-password payload shapes', () => {
    expect(CreatePlayerRequestSchema.safeParse({ username: 'alex', password: 'x' }).success).toBe(true);
    expect(CreatePlayerRequestSchema.safeParse({ username: 'alex' }).success).toBe(false);
    expect(
      ChangePasswordRequestSchema.safeParse({ currentPassword: 'a', newPassword: 'b' }).success,
    ).toBe(true);
    expect(ResetPasswordRequestSchema.safeParse({ newPassword: 'b' }).success).toBe(true);
    expect(ResetPasswordRequestSchema.safeParse({ newPassword: '' }).success).toBe(false);
  });
});
