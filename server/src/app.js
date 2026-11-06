import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { logger } from './utils/logger.js';
import { healthRouter } from './routes/health.js';
import { notFound, errorHandler } from './middleware/error.js';

/**
 * Middleware order (docs/01):
 * helmet → requestId + logger → json(100kb) → cookieParser → rateLimit → /api/auth → auth → /api → 404 → errors
 * Rate limiting and auth arrive in Phase 1.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/api', healthRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
