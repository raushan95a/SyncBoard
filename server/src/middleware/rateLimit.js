import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const handler = (_req, _res, next) => next(new ApiError(429, 'RATE_LIMITED'));
const skip = () => env.NODE_ENV === 'test';

/** /auth/login and /auth/register: 10 requests per 15 minutes per IP (docs/03). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler,
  skip,
});

/** Everything else: 300 requests per minute per user. Mounted after `auth`. */
export const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.user.id,
  handler,
  skip,
});
