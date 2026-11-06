import { Router } from 'express';
import os from 'node:os';
import { isDbUp } from '../config/db.js';

export const healthRouter = Router();

/** GET /api/healthz — used by the client, load balancers, and the multi-instance test. */
healthRouter.get('/healthz', (_req, res) => {
  const up = isDbUp();
  res.status(up ? 200 : 503).json({ ok: up, db: up ? 'up' : 'down', instance: os.hostname() });
});
