# 08 — Testing & Deployment

## Test Pyramid

| Layer | Tool | Focus |
|-------|------|-------|
| Unit | Vitest | `shared/position.js`, reducers, `eventPipeline`, selectors, Zod schemas |
| API integration | Vitest + Supertest + `mongodb-memory-server` | Routes, authentication, the authorization matrix, compare-and-set, move semantics |
| Socket integration | Vitest + `socket.io-client` against a real server | Handshake auth, join authorization, room isolation, revision sequence |
| Component | React Testing Library | Modal, conflict banner, optimistic rollback, render counts |
| E2E | Playwright | Two browser contexts syncing; reconnect |
| Load | Artillery (Socket.io engine) | p95 propagation, board load time |

Use `mongodb-memory-server` in **replica-set mode** (`MongoMemoryReplSet`). This is required, because every mutation runs in a transaction. It's used **only by automated tests**: development and production run on Atlas, and tests must never connect to Atlas (the test setup overrides `MONGO_URI`).

**The concurrency matrix in [11](11-FEATURE-WORKFLOWS.md#concurrency-matrix) is your test plan for concurrency.** Write one integration test per cell: fire both requests with `Promise.all`, then check that the database state and the events received by both sockets agree.

## Must-Have Test Cases

### Ordering
- [ ] `between(a, b)` returns a key strictly between a and b; works at the start, at the end, and on an empty list
- [ ] 1,000 repeated inserts at the same spot stay sorted, and the key-length threshold triggers a rebalance
- [ ] `comparePos` on the client gives the same order as the MongoDB sort, using random keys and IDs (a property-style test)
- [ ] A cross-list move changes only `listId` and `position`
- [ ] A stale neighbor (now in another list) is ignored; a neighbor from another board → 400

### Auth & Authorization (build this as a table-driven test)
- [ ] Unauthenticated → 401 on every protected route
- [ ] Non-member → 404 on every board, list, card, and comment route
- [ ] Viewer → 403 on every mutation route
- [ ] After logout (`tokenVersion` bumped), the old cookie → 401
- [ ] A socket without a cookie can't connect; a non-member can't `board:join`

### Concurrency
- [ ] Two content PATCHes with the same `version` → one 200 and one 409 (the 409 body contains `current`)
- [ ] A `completed` toggle doesn't bump `version`, so it doesn't conflict with a description edit
- [ ] Parallel moves of different cards both succeed with a valid final order
- [ ] Parallel drops of two cards into the same gap produce **distinct** position keys (ADR-014)
- [ ] 20 parallel mutations on one board → revisions are exactly 1 through 20, with no duplicates

### Realtime
- [ ] A's move → B receives `card:moved` with `revision = previous + 1`
- [ ] **A also receives it**, with A's `clientMutationId`
- [ ] Sockets in another board's room receive nothing
- [ ] Pipeline unit tests: events 7 then 6 → both applied in order; a missing 6 → reload after 500 ms; a duplicate → ignored; events buffered during load with revision ≤ the snapshot → dropped
- [ ] A removed member's socket gets `board:access-revoked` and no further events
- [ ] `board:join` racing a removal ends with the socket out of the room (ADR-018)

### Transactions and Cascades
- [ ] A failure inside `work()` (forced throw) → no data change **and** no revision increment
- [ ] Deleting a list removes its cards and comments; removing a member removes their assignments; deleting a label removes it from cards. Each emits exactly one event.
- [ ] A move that triggers a rebalance emits **one** event with `rebalanced` set

### Frontend (pure-function tests: fast and high value)
- [ ] `applyOp` for every op type
- [ ] Ops engine: toggle and move pending on one card → confirm the toggle → the card stays in its moved position
- [ ] Ops engine: a remote description update while a move is pending → displayed card has the new description **and** the moved position
- [ ] Ops engine: the move fails → the card goes back to the *latest* confirmed position (not the stale snapshot)
- [ ] Ops engine: a resync drops acked ops with revision ≤ R and keeps the rest
- [ ] Ops engine: indirect changes (`label:deleted`, `member:removed`, `rebalanced`) to a card with a pending op update its base, so the change survives the op's echo or failure (ADR-016)
- [ ] Modal merge: a 409 where only the other field changed → automatic retry; same field → banner
- [ ] Drag-and-drop with a filter active → neighbors taken from the visible IDs
- [ ] Moving one card re-renders only the affected components (render-count assertion)

## Example: Compare-and-Set Integration Test

```js
it('rejects stale content edits with 409', async () => {
  const { agent, card } = await seedCard();          // card.version === 0
  await agent.patch(`/api/cards/${card._id}/content`).send({ title: 'A', version: 0 }).expect(200);
  const res = await agent.patch(`/api/cards/${card._id}/content`).send({ title: 'B', version: 0 }).expect(409);
  expect(res.body.error.details.current.title).toBe('A');
});
```

## Example: Socket Test

```js
it('broadcasts moves to the whole room with sequential revisions', async () => {
  const { boardId, card, list2, cookies } = await seedBoardWithTwoMembers();
  const [a, b] = await Promise.all(cookies.map((c) => connectAndJoin(c, boardId)));
  const gotA = once(a, 'card:moved'), gotB = once(b, 'card:moved');
  await agentA.patch(`/api/cards/${card._id}/move`).send({ toListId: list2._id, clientMutationId: 'm1' }).expect(200);
  const [[evA], [evB]] = await Promise.all([gotA, gotB]);
  expect(evA.clientMutationId).toBe('m1');
  expect(evB.revision).toBe(evA.revision);
});
```

## Example: Playwright Sync Test

```js
test('card move syncs between users', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await loginAs(a, 'alice'); await loginAs(b, 'bob');
  await a.goto(boardUrl); await b.goto(boardUrl);
  await dragCard(a, 'Task 1', 'Done');
  await expect(b.locator('[data-list="Done"]').getByText('Task 1')).toBeVisible();
});
```

## Load Testing

Use Artillery with the Socket.io engine: 50 clients join one board while 10 moves per second hit the REST API. Measure p95 from the REST request to the event arriving on other clients, plus server CPU. Seed a 2,000-card board and time `GET /boards/:id`. **Put the numbers in the README.**

### Measured (Phase 7, 2026-11-06)

Seed: `npm run seed -w server` (1 board × 5 lists × 500 cards = 2,500 cards; remove with `-- --drop`).
Server numbers go through the real services, transactions included, against Atlas M0 (`collabboard-dev`) from a home
connection, so they are dominated by network round trips and vary a lot between runs:

| Measure | Run 1 | Run 2 |
|---------|-------|-------|
| Snapshot size (`GET /boards/:id` body) | 982 KB | 982 KB |
| Snapshot load, median / p95 (10 runs) | 1,688 / 10,985 ms | 480 / 1,169 ms |
| Card move (neighbor resolution + transaction), median / p95 (20 runs) | 224 / 689 ms | 230 / 468 ms |

Client store work for the same board (`npm run bench -w client`, Node, before React renders):

| Measure | Median |
|---------|--------|
| Apply the 2,500-card snapshot | 3.1 ms |
| Optimistic move (`opStarted`) | 4.1 ms |
| Echo confirm (`card:moved`) | 2.5 ms |
| Filter one 500-card column (cold cache) | 0.03 ms |

### Measured (Phase 8, 2026-11-06): propagation

`node load/propagation.js` (ADR-026): 50 sockets on one board, one user moving cards over REST.
Propagation = REST request sent → `card:moved` received by each of the 50 other sockets.

| Target | Rate | Delivered | Propagation p50 / p95 / max | REST p50 / p95 |
|--------|------|-----------|-----------------------------|----------------|
| e2e server, in-memory MongoDB (server cost only) | 10 moves/s × 30 s | 15,000 / 15,000 | 18 / 36 / 43 ms | 20 / 38 ms |
| Dev stack via Vite proxy, Atlas M0 (home connection) | 4 moves/s × 30 s | 6,000 / 6,000 | 728 / 4,491 / 8,708 ms | 729 / 4,492 ms |

Propagation tracks the REST time almost exactly: the event leaves right after the commit, so the cost is the transaction. Against
the remote free tier, each transaction makes several round trips, and because writes to one board are serialized
(ADR-010/015), 4 moves/s on a single board starts to queue; that queueing is the p95 tail. No event was lost in any run.
(The dev API allows 300 requests/minute per user, which caps that run at 5 moves/s.)

Rendering: the render-count test asserts that a move re-renders exactly 3 components (source column, destination column,
moved card). The optimistic move is applied before the request, so drag latency is the ~4 ms store update, not the
~230 ms server round trip. Still to do: browser timings (first paint of the 2,500-card board) and the Artillery run.

## Docker

Docker is only needed in Phase 8, for the production image and the multi-instance test. The database is always Atlas, so there's no `mongo` service.

**docker-compose.yml**
```yaml
services:
  redis:
    image: redis:7
    profiles: ["scale"]
  app:
    build: .
    env_file: ./server/.env          # MONGO_URI (Atlas) + MONGO_DB
    ports: ["4000:4000"]
```

**Dockerfile** (root, multi-stage). It builds the client, and the server serves `client/dist`, so you get **one origin**:
```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY client/package.json client/ ; COPY server/package.json server/ ; COPY shared/package.json shared/
RUN npm ci
COPY . .
RUN npm run build -w client

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY server/package.json server/ ; COPY shared/package.json shared/
RUN npm ci --omit=dev -w server -w shared --include-workspace-root
COPY server/src server/src
COPY shared/src shared/src
COPY --from=build /app/client/dist server/public
USER node
EXPOSE 4000
CMD ["node", "server/src/index.js"]
```
> The `;`-separated `COPY` lines are shorthand. In a real Dockerfile, put each `COPY` on its own line.

In `app.js`, for production: `app.use(express.static('server/public'))`, plus an SPA fallback that returns `index.html` for any GET request that isn't `/api` or `/socket.io`.

## Multi-Instance Verification (Phase 8)

1. Run two app containers with `REDIS_URL` set (`docker compose --profile scale up`).
2. Put an nginx upstream in front with `ip_hash` (sticky sessions) and WebSocket upgrade headers:
```nginx
upstream backend { ip_hash; server app1:4000; server app2:4000; }
location / {
  proxy_pass http://backend;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```
3. Connect user A to app1 and user B to app2 (use the `/api/healthz` response's instance ID to confirm), move a card, and check that B sees it.

## CI (GitHub Actions)

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm test --workspaces --if-present
      - run: npm run build -w client
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      - run: npm audit --omit=dev --audit-level=high
```

## Deployment (same origin)

| Part | Option |
|------|--------|
| App (API + static client) | Render, Railway, or Fly.io: one service, with WebSockets supported |
| Database | MongoDB Atlas (free M0 tier; it's a replica set, so transactions work). `MONGO_DB=collabboard-prod` in production, `collabboard-dev` locally. |
| Redis (only if scaled) | Upstash or Redis Cloud |

Avoid putting the client on Vercel and the API on Render under different domains. That makes the cookie a third-party cookie (see [06](06-SECURITY-AUTH.md)). If you want a separate CDN for the client, put both behind one custom domain.

Production checklist: HTTPS, `NODE_ENV=production`, `trust proxy` set (for secure cookies and rate limiting behind the platform's proxy), `/api/healthz`, **graceful shutdown** (stop accepting connections → `io.close()` → wait for in-flight requests → `mongoose.disconnect()`), structured logs, Atlas IP allowlist, and backups enabled.
