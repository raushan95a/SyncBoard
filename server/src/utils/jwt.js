import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export const COOKIE_NAME = 'token';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

/** @param {{ _id: unknown, tokenVersion: number }} user */
export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), tv: user.tokenVersion }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });

/** @returns {{ sub: string, tv: number }} throws if invalid or expired */
export const verifyToken = (token) => jwt.verify(token, env.JWT_SECRET);

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
});

export const setAuthCookie = (res, token) => res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: MAX_AGE_MS });
export const clearAuthCookie = (res) => res.clearCookie(COOKIE_NAME, cookieOptions());
