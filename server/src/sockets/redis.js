import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { logger } from '../utils/logger.js';

/**
 * Multi-instance fan-out (docs/04 — Scaling). Only used when REDIS_URL is set: then publish(),
 * socketsLeave() and disconnectSockets() reach sockets on every instance. Revisions stay correct
 * across instances because MongoDB transactions serialize writes per board; events from different
 * instances may arrive out of order, which the client's reorder buffer absorbs.
 *
 * Load balancers must use sticky sessions (long-polling), or clients must use websocket only.
 */
export async function attachRedisAdapter(io, url) {
  const pub = createClient({ url });
  const sub = pub.duplicate();
  for (const c of [pub, sub]) c.on('error', (err) => logger.error({ err }, 'redis error'));
  await Promise.all([pub.connect(), sub.connect()]);
  io.adapter(createAdapter(pub, sub));
  logger.info('socket.io redis adapter attached');
  return async () => {
    await Promise.allSettled([pub.quit(), sub.quit()]);
  };
}
