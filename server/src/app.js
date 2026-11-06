import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
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
/** Where the production build of the client lives (copied there by the Dockerfile / e2e setup). */
export const DEFAULT_STATIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/**
 * @param {{ staticDir?: string }} [opts]  serve this built client (single origin) if it exists
 */
export function createApp({ staticDir = DEFAULT_STATIC_DIR } = {}) {
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

  // Single origin in production (docs/06): the same server serves the built client. Any GET that
  // isn't the API or the socket endpoint falls back to index.html, so deep links work.
  if (existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.set('Cache-Control', 'no-cache').sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
