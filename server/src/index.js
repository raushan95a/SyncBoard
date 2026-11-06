import http from 'node:http';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { sweepOrphans } from './services/orphanSweep.js';
import { createIO } from './sockets/index.js';
import { attachRedisAdapter } from './sockets/redis.js';

const CONNECT_ATTEMPTS = 6;

/**
 * Atlas SRV lookups occasionally fail transiently (querySrv ESERVFAIL). Retry with exponential
 * backoff (1, 2, 4, 8, 16 s) before giving up, so a DNS blip doesn't leave the server dead.
 */
async function connectWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connectDB(env.MONGO_URI, env.MONGO_DB);
    } catch (err) {
      if (attempt >= CONNECT_ATTEMPTS) throw err;
      const delay = 1000 * 2 ** (attempt - 1);
      logger.warn({ attempt, delayMs: delay, code: err?.code, msg: err?.message }, 'MongoDB connect failed; retrying');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function main() {
  await connectWithRetry();
  logger.info({ db: env.MONGO_DB }, 'connected to MongoDB');

  // Clean up children of boards whose batched delete was interrupted (ADR-019). Not awaited.
  sweepOrphans()
    .then((n) => n && logger.warn({ boards: n }, 'orphan sweep removed leftovers'))
    .catch((err) => logger.error({ err }, 'orphan sweep failed'));

  const server = http.createServer(createApp());
  const io = createIO(server);
  const closeRedis = env.REDIS_URL ? await attachRedisAdapter(io, env.REDIS_URL) : async () => {};

  server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));

  // Graceful shutdown (docs/08): stop accepting → drop sockets (clients reconnect to another
  // instance and resync) → wait for in-flight requests → close Redis and the DB.
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    io.disconnectSockets(true);
    server.close(async () => {
      await closeRedis();
      await disconnectDB().catch(() => {});
      clearTimeout(force);
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
