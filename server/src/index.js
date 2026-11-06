import http from 'node:http';
import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

async function main() {
  await connectDB(env.MONGO_URI, env.MONGO_DB);
  logger.info({ db: env.MONGO_DB }, 'connected to MongoDB');

  const server = http.createServer(createApp());
  // Socket.io attaches to this server in Phase 4.

  server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));

  // Graceful shutdown: stop accepting connections → wait for in-flight requests → disconnect DB.
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
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
