import * as authService from '../services/authService.js';
import { toPublicUser } from '../models/User.js';
import { signToken, setAuthCookie, clearAuthCookie } from '../utils/jwt.js';
import { resolveUser } from '../middleware/auth.js';

export async function register(req, res) {
  const user = await authService.register(req.valid.body);
  setAuthCookie(res, signToken(user));
  res.status(201).json({ data: { user: toPublicUser(user) } });
}

export async function login(req, res) {
  const user = await authService.login(req.valid.body);
  setAuthCookie(res, signToken(user));
  res.json({ data: { user: toPublicUser(user) } });
}

/** Works even with an invalid or expired cookie: logging out should never fail. */
export async function logout(req, res) {
  if (req.valid.body.everywhere) {
    const user = await resolveUser(req);
    if (user) await authService.revokeAllSessions(user._id);
  }
  clearAuthCookie(res);
  res.json({ data: { ok: true } });
}

export function me(req, res) {
  res.json({ data: { user: toPublicUser(req.userDoc) } });
}
