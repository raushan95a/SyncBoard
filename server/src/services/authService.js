import bcrypt from 'bcryptjs';
import { User, AVATAR_COLORS } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

const INVALID_LOGIN = 'Invalid email or password';

// Compared against when the email doesn't exist, so response timing doesn't reveal
// which emails are registered (docs/06). Created lazily with the configured cost.
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await bcrypt.hash('not-a-real-password', env.BCRYPT_COST));

export async function register({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, env.BCRYPT_COST);
  const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
  try {
    return await User.create({ name, email, passwordHash, avatarColor });
  } catch (err) {
    if (err?.code === 11000) {
      throw new ApiError(400, 'EMAIL_TAKEN', 'An account with that email already exists', [
        { in: 'body', path: 'email', message: 'An account with that email already exists' },
      ]);
    }
    throw err;
  }
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash').lean();
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) throw new ApiError(401, 'UNAUTHENTICATED', INVALID_LOGIN);
  return user;
}

/** Revokes every session of this user: all existing tokens stop matching tokenVersion. */
export async function revokeAllSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  // Phase 4: publishUser(userId, EVT.SESSION_REVOKED) + disconnect the user's sockets.
}
