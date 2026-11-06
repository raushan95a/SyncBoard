import { User } from '../models/User.js';
import { COOKIE_NAME, verifyToken } from '../utils/jwt.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Resolves the cookie to a user, or null. Checks tokenVersion so logout-everywhere
 * revokes old tokens immediately (docs/06).
 */
export async function resolveUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return null;
  }
  const user = await User.findById(payload.sub).lean();
  if (!user || user.tokenVersion !== payload.tv) return null;
  return user;
}

/** Requires a valid session. Sets req.user = { id, name, avatarColor }. */
export async function auth(req, _res, next) {
  const user = await resolveUser(req);
  if (!user) throw new ApiError(401, 'UNAUTHENTICATED');
  req.user = { id: String(user._id), name: user.name, avatarColor: user.avatarColor };
  req.userDoc = user;
  next();
}
