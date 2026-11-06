import mongoose from 'mongoose';
import { LIMITS } from '@syncboard/shared/limits';

export const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6'];

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: LIMITS.USER_NAME },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  avatarColor: { type: String, default: AVATAR_COLORS[0] },
  tokenVersion: { type: Number, default: 0 },          // bump → revokes every session (docs/06)
}, { timestamps: true });

/** The only shape of a user that ever leaves the server. */
export const toPublicUser = (u) => ({
  _id: String(u._id),
  name: u.name,
  email: u.email,
  avatarColor: u.avatarColor,
});

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
