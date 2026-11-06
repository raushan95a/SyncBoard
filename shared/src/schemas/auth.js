import { z } from 'zod';
import { LIMITS } from '../limits.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));

export const registerSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name is required').max(LIMITS.USER_NAME),
  email,
  password: z.string()
    .min(LIMITS.PASSWORD_MIN, `Password must be at least ${LIMITS.PASSWORD_MIN} characters`)
    .max(LIMITS.PASSWORD_MAX),
});

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, 'Password is required').max(LIMITS.PASSWORD_MAX),
});

export const logoutSchema = z.strictObject({
  everywhere: z.boolean().optional(),
});
