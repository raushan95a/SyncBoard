import pino from 'pino';
import { env } from '../config/env.js';

/** Structured logger. Never log passwords, cookies, or tokens (docs/06). */
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.passwordHash'],
    censor: '[redacted]',
  },
});
