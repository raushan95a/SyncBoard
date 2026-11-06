import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';
import { auth } from './middleware/auth.js';
import { requireJson } from './middleware/requireJson.js';
import { userLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/error.js';

/**
 * Middleware order (docs/01):
 * helmet → requestId + logger → requireJson → json(100kb) → cookieParser
 * → /api/healthz → /api/auth (IP rate limit) → auth → per-user rate limit → /api routes → 404 → errors
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);   // secure cookies + real client IP behind the platform proxy

  app.use(helmet());
  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
  }));
  app.use('/api', requireJson);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);

  // Everything below requires a session.
  app.use('/api', auth, userLimiter, apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
