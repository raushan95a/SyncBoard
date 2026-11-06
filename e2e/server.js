/**
 * End-to-end test server (docs/08). The real app — REST, Socket.io, and the BUILT client on one
 * origin, exactly like production — on an in-memory MongoDB replica set, so E2E runs need no Atlas
 * and no secrets (locally or in CI).
 *
 *   node e2e/server.js        # http://localhost:4100 (app), http://localhost:4101 (test control)
 *
 * The control port can restart the app's HTTP server and, while every client is disconnected,
 * commit a change whose event nobody receives — exactly what a real crash between commit and
 * emit, or a deploy, looks like to the clients.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PORT = 4100;
const CONTROL_PORT = 4101;

const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, {
  NODE_ENV: 'test',                       // no rate limits, no secure cookie (plain http), quiet logs
  PORT: String(PORT),
  MONGO_URI: replSet.getUri(),
  MONGO_DB: 'collabboard-e2e',
  JWT_SECRET: 'e2e-secret-'.padEnd(64, 'x'),
  BCRYPT_COST: '4',
});

// Imported only after the environment is set: config/env.js reads it at import time.
const { connectDB } = await import('../server/src/config/db.js');
const { createApp } = await import('../server/src/app.js');
const { createIO } = await import('../server/src/sockets/index.js');
const { Card } = await import('../server/src/models/Card.js');
const { updateContent } = await import('../server/src/services/cardService.js');

await connectDB(process.env.MONGO_URI, process.env.MONGO_DB);
const staticDir = fileURLToPath(new URL('../client/dist', import.meta.url));
const server = http.createServer(createApp({ staticDir }));
const io = createIO(server);
const listen = () => new Promise((resolve) => server.listen(PORT, resolve));
await listen();

/** Simulated restart: drop every client, stay down for `downMs`, optionally commit a change meanwhile. */
async function restart({ downMs = 1500, renameCard } = {}) {
  io.disconnectSockets(true);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (renameCard) {
    const card = await Card.findById(renameCard.cardId).lean();
    // A real committed mutation; its event goes to an empty room and is lost.
    await updateContent(card._id, card.boardId, { title: renameCard.title, version: card.version }, { actorId: card.createdBy });
  }
  await new Promise((r) => setTimeout(r, downMs));
  await listen();
}

http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/restart') {
      let body = '';
      for await (const chunk of req) body += chunk;
      await restart(body ? JSON.parse(body) : {});
      res.writeHead(200).end('restarted');
    } else {
      res.writeHead(404).end();
    }
  } catch (err) {
    res.writeHead(500).end(String(err?.stack ?? err));
  }
}).listen(CONTROL_PORT);

console.log(`e2e server ready on http://localhost:${PORT} (control :${CONTROL_PORT})`);

const stop = async () => {
  io.close();
  await replSet.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
