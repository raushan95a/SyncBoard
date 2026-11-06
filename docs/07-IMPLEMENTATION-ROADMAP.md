# 07 — Implementation Roadmap

Work from top to bottom. **Each phase ends with something you can demo and with its tests passing.** Don't save testing for the end. For each feature, use the matching section of [11-FEATURE-WORKFLOWS](11-FEATURE-WORKFLOWS.md) as its acceptance checklist.

Commit using Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`) and tag each phase (`v0.1-auth`, …). A clean history is part of what interviewers look at.

---

## Phase 0 — Setup (½ day)

- [x] `git init`, a root `package.json` with `"workspaces": ["client", "server", "shared"]`, `"type": "module"`, `"engines": { "node": ">=24" }`, `.nvmrc` (24), `.gitignore`, `.editorconfig`
- [x] **server:** `express@5 mongoose@9 socket.io helmet cookie-parser cookie jsonwebtoken bcryptjs zod express-rate-limit fractional-indexing dotenv pino pino-http`
- [x] **server (dev):** `vitest supertest mongodb-memory-server socket.io-client`
- [x] **client:** Vite React template, plus `@reduxjs/toolkit react-redux react-router-dom socket.io-client @hello-pangea/dnd nanoid bson-objectid react-hot-toast react-markdown` (verified: `@hello-pangea/dnd@18` peer-depends on `react ^18 || ^19`)
- [x] **shared:** `fractional-indexing zod`. Export `events.js`, `position.js`, `roles.js`, `limits.js`, `schemas/`
- [x] Root scripts: `dev` (both apps via `concurrently`), `test`, `lint`
- [x] Vite proxy for `/api` and `/socket.io` (`ws: true`)
- [x] MongoDB Atlas M0 cluster; `MONGO_URI` (`mongodb+srv://…`) and `MONGO_DB=collabboard-dev` in `server/.env` (git-ignored), with a committed `server/.env.example`
- [x] `config/env.js` (Zod), `config/db.js` (connect with `dbName: env.MONGO_DB`), `GET /api/healthz`
- [x] Test harness: `MongoMemoryReplSet` in a Vitest global setup, so tests never touch Atlas
- [x] **Done when:** `npm run dev` shows a React page displaying `healthz: ok` (db up), `npm test` passes against the in-memory replica set, and `npm run db:check -w server` runs a test transaction against Atlas

## Phase 1 — Auth (1 day) · F1

- [x] User model, register/login/logout(`everywhere`)/me, `tokenVersion`
- [x] bcryptjs, JWT cookie, `auth` middleware, `ApiError`, error handler, `validate()`
- [x] Client: login and register pages (shared schemas), `authSlice`, `ProtectedRoute`, boot check with `/auth/me`, the http wrapper's 401 → logout rule
- [x] **Tests:** register → me → logout → 401; generic login error; duplicate email; a revoked `tokenVersion` → 401
- [x] **Done when:** a refresh keeps you logged in; logout everywhere logs out a second browser

## Phase 2 — Core Data and CRUD, no realtime yet (2–3 days) · F2, F4, F5, F7, F8

- [x] Models with limits and indexes ([02](02-DATABASE-SCHEMA.md)), including the board `labels` default palette
- [x] **`mutateBoard()`**: every mutation goes through it from day one, even before sockets exist
- [x] `loadResource` + `requireRole` middleware
- [x] Boards: list, create (basic or empty template), rename, delete (cascade)
- [x] Lists and cards: create with optional client `_id` (idempotent), rename or update, delete (cascade)
- [x] `PATCH /cards/:id/content` compare-and-set; `PATCH /cards/:id` last-write-wins; assignee and label add/remove
- [x] `GET /boards/:id` (board first, then children)
- [x] Orphan sweep on startup ([02](02-DATABASE-SCHEMA.md#cascades-all-within-mutateboard-one-event-each))
- [x] Client, **kept minimal** (ADR-023): boards page, board view, add list/card forms, card modal (basic save, no conflict UI), label chips, due-date chip. Every change is a plain request followed by a **refetch** of the board. No optimistic state yet; Phase 3 replaces this with the ops engine.
- [x] **Tests:** the authorization matrix (non-member → 404, viewer → 403 on every mutation route); stale version → 409 with `current`; `completed` doesn't bump `version`; a repeated create with the same `_id` → 200
- [x] **Done when:** you can build a full board in the UI and it persists

## Phase 3 — Drag & Drop + Pending-Ops Engine (2–3 days) · F6

- [ ] `PATCH /cards/:id/move` and `/lists/:id/move`: successor-based neighbor resolution (ADR-014), tolerance for stale neighbors, rebalance in the same transaction
- [ ] Client `ops.js` (`applyOp`), slice with `bases` + `ops`, `opStarted` / `opAcked` / `opFailed`
- [ ] `sendSerial(entityId, fn)`: one request in flight per entity
- [ ] Convert create, update, and delete from Phase 2 to ops (optimistic everywhere except comments)
- [ ] `@hello-pangea/dnd` with `LIST` and `CARD` droppables
- [ ] **Tests:**
  - `position.js` unit tests (between, ends, 1,000 inserts at the same spot stay sorted, `comparePos` matches the MongoDB sort)
  - move integration tests (cross-list, stale neighbor, foreign neighbor → 400, rebalance, two parallel drops into the same gap → **distinct** keys)
  - `ops` reducer tests: toggle and move on the same card, then confirm the first → no jump; fail the second → only it is undone
- [ ] **Manual:** stop the server mid-drag → the card snaps back and a toast appears
- [ ] **Done when:** every action feels instant and rolls back correctly on failure

## Phase 4 — Real-Time Sync (3 days, the core) · F3, F16

- [ ] Socket server, handshake auth, `user:<id>` room, authorized `board:join` (one board per socket, membership re-checked after joining)
- [ ] `publish()` / `publishUser()` called after `mutateBoard()` in **every** service, emitting the event catalog from [04](04-REALTIME-SOCKETS.md#event-catalog)
- [ ] Client `remote.js` (`applyEvent`) for every event, including `rebalanced`, `list:deleted` (removes cards), `member:removed`, `label:deleted`
- [ ] `eventPipeline`: pause/buffer (for load **and** drag), revision check, reorder buffer, 500 ms gap timer, `resync()`
- [ ] Own-echo confirmation and the rebase of pending ops on remote events
- [ ] `useBoardSocket`: join → pause → fetch → resetTo → resume; `ConnectionBanner`; global `connect_error` handling
- [ ] **Tests:**
  - socket integration: no cookie → rejected; non-member join → error; A's move reaches A (with its `clientMutationId`) and B with the same revision; another board's room receives nothing
  - 20 parallel mutations → revisions 1 through 20 exactly
  - pipeline unit tests: events 7 then 6 → both applied in order; missing 6 → resync after 500 ms; duplicate → ignored; events during a drag → buffered
  - **indirect-change reducer test** (ADR-016): a card with a pending op receives `label:deleted` / `member:removed` / `rebalanced` → after the op is echoed *or* fails, the label/assignee stays gone and the position is the rebalanced one
- [ ] **Done when:** two browsers stay in sync for every action, and a server restart resyncs both with no user action

## Phase 5 — Collaboration UX (2 days) · F7, F14

- [ ] Modal draft/`draftBase` model, debounced serial autosave, the "changed by X" pill on dirty fields
- [ ] Three-way automatic merge on 409, plus the conflict banner for real conflicts
- [ ] Flush the draft on close, and back it up to `sessionStorage`
- [ ] Presence bar (deduplicated); "is editing" with heartbeat and expiry
- [ ] **Tests:** title-versus-description concurrent edit → no banner, both saved; description-versus-description → banner; component test of the banner's three actions
- [ ] **Done when:** concurrent edits are never silently overwritten, and edits to different fields never show a conflict

## Phase 6 — Members, Labels, Comments, Archive (2 days) · F9–F13

- [ ] Members: invite, change role, remove or leave; last-owner rule; `member:*`, `board:access-revoked`, `boards:changed`
- [ ] Boards page live through `boards:changed`; `board:deleted` → full-page "gone" view
- [ ] Labels editor (create, rename, recolor, delete with cascade)
- [ ] Comments: pagination, `commentCount`, live updates
- [ ] Archive panel: `GET /boards/:id/archived`, restore (append to the end; 422 if the list is archived), permanent delete
- [ ] Viewer role: read-only UI everywhere
- [ ] **Tests:** a removed member loses REST and socket access right away and is unassigned from cards; deleting a label removes it from cards; last owner can't leave; restore into an archived list → 422

## Phase 7 — Filters, Performance, Polish (1–2 days) · F15

- [ ] Filter bar (text, members, labels, due), kept in the URL, with dragging working while filtered (visible neighbors)
- [ ] `React.memo` and memoized per-list selectors; a render-count test (a move re-renders exactly three components)
- [ ] Seed script: 1 board × 5 lists × 500 cards; record load and drag timings
- [ ] Skeletons, empty states, confirm dialogs, keyboard drag-and-drop, responsive layout, due-date colors
- [ ] Optional: an `Activity` collection written inside `mutateBoard`, shown as card history

## Phase 8 — Hardening, E2E, Deploy (2 days)

- [ ] Security checklist ([06](06-SECURITY-AUTH.md))
- [ ] Playwright: two-user sync, the concurrency matrix's key cells ([11](11-FEATURE-WORKFLOWS.md#concurrency-matrix)), reconnect after a server restart, member removal
- [ ] Redis adapter and a two-instance test behind nginx
- [ ] Single-origin Docker image, CI, deploy (Render/Railway/Fly + Atlas)
- [ ] Artillery load test; record p95 propagation
- [ ] README: GIF demo, architecture diagram, trade-offs (from [10](10-DECISION-LOG.md)), measured numbers, live link

---

## Stretch Goals (pick one at most, and only after Phase 8)

| Goal | Why it's interesting |
|------|----------------------|
| Undo/redo | Inverse ops fit naturally into the ops engine |
| Offline mode | The ops queue already exists. Persist it to IndexedDB and replay on reconnect (`clientMutationId` and client IDs make replays idempotent) |
| Collaborative description editing with Yjs | Shows when a CRDT is worth adding |
| Change streams or an outbox as the broadcast source | Decouples writes from fan-out |
| Attachments via S3 presigned URLs | Direct uploads that never pass through your server |
| Email invitations for unregistered users | Invite tokens, expiry |

## Definition of Done (whole project)

- [ ] Every cell of the concurrency matrix ends with all clients matching the database
- [ ] Restarting the server → clients reconnect and resync automatically
- [ ] No unauthorized access to another board (verified by tests)
- [ ] The profiler shows no full-board re-render on a card move
- [ ] CI is green, and a live demo URL is in the README
- [ ] The README explains the design decisions and trade-offs, with measured numbers
