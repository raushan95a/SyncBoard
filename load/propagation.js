/**
 * Propagation load test (docs/08 — Load Testing): CLIENTS sockets join one board while one user
 * moves cards at RATE moves/second over REST. For every move, measures the time from sending the
 * REST request to the `card:moved` event arriving at each OTHER socket, and reports p50/p95/max.
 *
 *   node load/propagation.js [--base http://localhost:4100] [--clients 50] [--rate 10] [--seconds 30]
 *
 * Point it at the e2e server (in-memory MongoDB: server cost only) or at the dev stack through
 * the Vite proxy (Atlas: realistic). Outside NODE_ENV=test the API allows 300 requests/minute
 * per user, so keep --rate ≤ 4 there.
 */
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { io } = require('socket.io-client');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const BASE = arg('base', 'http://localhost:4100');
const CLIENTS = Number(arg('clients', 50));
const RATE = Number(arg('rate', 10));
const SECONDS = Number(arg('seconds', 30));

async function register(name) {
  const email = `load-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@load.io`;
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password: 'password123' }),
  });
  if (!r.ok) throw new Error(`register → ${r.status}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const call = async (method, path, body) => {
    const res = await fetch(`${BASE}/api${path}`, {
      method, headers: { cookie, ...(body && { 'Content-Type': 'application/json' }) }, body: body && JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${json?.error?.code}`);
    return json.data;
  };
  return { email, cookie, call };
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.ceil(xs.length * p) - 1)];
const r1 = (x) => Math.round(x * 10) / 10;

const owner = await register('owner');
const watcher = await register('watcher');
const { board } = await owner.call('POST', '/boards', { title: 'Load test' });
await owner.call('POST', `/boards/${board._id}/members`, { email: watcher.email, role: 'viewer' });
const snap = await owner.call('GET', `/boards/${board._id}`);
const [a, b] = snap.lists;
const cards = [];
for (let i = 0; i < 10; i++) cards.push((await owner.call('POST', `/lists/${a._id}/cards`, { title: `Load ${i}` })).card);

// Watchers: CLIENTS sockets (as the watcher user) joined to the board.
const sent = new Map();                 // clientMutationId → send time
const latencies = [];
const sockets = await Promise.all(Array.from({ length: CLIENTS }, () => new Promise((resolve, reject) => {
  const s = io(BASE, { transports: ['websocket'], extraHeaders: { cookie: watcher.cookie }, reconnection: false });
  s.on('connect_error', reject);
  s.on('connect', async () => {
    const ack = await s.emitWithAck('board:join', { boardId: board._id });
    if (!ack.ok) return reject(new Error(`join → ${JSON.stringify(ack)}`));
    resolve(s);
  });
  s.on('card:moved', (p) => {
    const t0 = sent.get(p.clientMutationId);
    if (t0 !== undefined) latencies.push(performance.now() - t0);
  });
})));
console.log(`${sockets.length} sockets joined; ${RATE} moves/s for ${SECONDS}s against ${BASE}`);

// Driver: RATE moves per second, alternating cards between two lists.
let moves = 0;
let errors = 0;
const inflight = [];
const restMs = [];
const total = RATE * SECONDS;
const started = performance.now();
await new Promise((done) => {
  const timer = setInterval(async () => {
    if (moves >= total) {
      clearInterval(timer);
      // Wait for every request to settle, then give the last events time to arrive.
      Promise.allSettled(inflight).then(() => setTimeout(done, 2000));
      return;
    }
    const n = moves++;
    const card = cards[n % cards.length];
    const toListId = Math.floor(n / cards.length) % 2 === 0 ? b._id : a._id;
    const mid = `load-${n}`;
    const t0 = performance.now();
    sent.set(mid, t0);
    const req = owner.call('PATCH', `/cards/${card._id}/move`, { toListId, clientMutationId: mid })
      .then(() => restMs.push(performance.now() - t0), () => { errors++; });
    inflight.push(req);
    await req;
  }, 1000 / RATE);
});

for (const s of sockets) s.close();
latencies.sort((x, y) => x - y);
restMs.sort((x, y) => x - y);
const expected = (moves - errors) * CLIENTS;
console.log(JSON.stringify({
  base: BASE,
  clients: CLIENTS,
  moves,
  errors,
  durationS: r1((performance.now() - started) / 1000),
  delivered: `${latencies.length}/${expected}`,
  rate: RATE,
  propagationMs: { p50: r1(pct(latencies, 0.5)), p95: r1(pct(latencies, 0.95)), max: r1(latencies.at(-1)) },
  restMs: { p50: r1(pct(restMs, 0.5)), p95: r1(pct(restMs, 0.95)) },
  boardId: board._id,
}, null, 2));
process.exit(0);
