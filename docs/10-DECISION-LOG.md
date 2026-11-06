# 10 — Decision Log (ADRs)

Short Architecture Decision Records. Each one gives the context, the decision, the alternatives considered, and the consequences. Add a new record whenever you change a decision; don't rewrite old ones. When a later ADR refines an earlier one, the earlier one gets an "Amended by" note.

---

## ADR-001: REST for mutations, WebSocket for fan-out only
**Status:** Accepted

**Context:** Clients need to change data and to see other users' changes live.
**Decision:** All mutations go through REST. The server publishes socket events after the commit. The only client-to-server socket messages are join/leave and short-lived presence events.
**Alternatives:** (a) Mutations over the socket: you lose HTTP status codes, middleware, and easy testing, and you'd need your own acknowledgement and error protocol. (b) The client emits events itself: other users could see changes that later fail to save, and clients could forge events.
**Consequences:** Two channels to keep in step, which the revision protocol handles (ADR-004). The cost is one extra hop of latency, which optimistic UI hides.

## ADR-002: Normalized collections
**Status:** Accepted

**Decision:** Separate User, Board, List, Card, and Comment collections. `boardId` is denormalized onto Card and Comment. Members are embedded in Board, with a cap of about 100.
**Alternatives:** Embedding cards in lists: the 16 MB limit, write contention on one document, and the whole list rewritten on every card edit.
**Consequences:** Loading a board takes three queries, and deletes have to cascade explicitly.

## ADR-003: Fractional-index string positions
**Status:** Accepted — amended by ADR-014

**Decision:** `position: String` generated with `fractional-indexing`, sorted by `(position, _id)`, with a rebalance when keys grow too long.
**Alternatives:** (a) Order arrays on the parent: two sources of truth, and a hot array rewritten on every move. (b) Integer gaps: they run out, forcing a renumber. (c) Float midpoints: precision runs out after about 50 halvings.
**Consequences:** A move writes one document. A rebalance is needed occasionally; its new positions travel inside the same event as the move or create that caused it (the `rebalanced` field, ADR-004), not as a separate event. Client and server must compare keys exactly the same way, which is why the comparison lives in `shared/`.

## ADR-004: Per-board revision with whole-room broadcast
**Status:** Accepted

**Decision:** Each mutation does `$inc board.revision` (in the same transaction as the data write, see ADR-010) and emits exactly one event, carrying full entity state and `clientMutationId`, to the *whole* room. Side effects such as a rebalance ride along in the same event (`rebalanced`). Only socket events advance the client's revision. Clients reorder events, pause during load and drag, and reload when a gap persists.
**Alternatives:** (a) Excluding the sender: its sequence has gaps, so it reloads after its own changes. (b) Advancing the revision from REST responses: races can make a client skip a teammate's event. (c) No revision at all: missed or reordered events go undetected, and clients silently drift apart.
**Consequences:** One hot counter per board, which is fine at our scale. Self-healing after a crash between the commit and the emit.

## ADR-005: Field-specific concurrency control
**Status:** Accepted

**Decision:** Compare-and-set on `version` for `title` and `description`. Last-write-wins `$set` for single-value fields. `$addToSet`/`$pull` for assignees and labels.
**Alternatives:** (a) Version every field: toggling `completed` would cause false conflicts on a description edit. (b) Mongoose `optimisticConcurrency`: it only protects the window between a read and a save on the server, not the user's stale view.
**Consequences:** Two update endpoints (`/content` and `/`), and the UI has to handle a 409.

## ADR-006: No CRDT/OT for text (for now)
**Status:** Accepted — revisit if descriptions become long shared documents

**Decision:** Whole-field versioning plus an advisory "is editing" indicator.
**Alternatives:** Yjs or Automerge for character-level merging.
**Consequences:** Simultaneous edits to the same field produce a conflict prompt instead of a merge. That's acceptable for short fields.

## ADR-007: Same-origin deployment with an HTTP-only cookie JWT
**Status:** Accepted

**Decision:** The Vite proxy in development; in production, Express serves the client build, or a reverse proxy puts both under one origin. `SameSite=Lax`, required JSON content type, and `tokenVersion` for revocation.
**Alternatives:** (a) A token in localStorage: XSS could steal it. (b) Client and API on different sites: third-party cookies, which Safari blocks, plus CSRF tokens.
**Consequences:** One deployable app. No CORS configuration needed.

## ADR-008: Shared workspace package
**Status:** Accepted

**Decision:** An npm-workspaces monorepo with `shared/` holding event names, Zod schemas, position helpers, and roles.
**Consequences:** A typo in an event name or a mismatch in validation becomes an import or build error. Adds a little workspace tooling.

## ADR-009: JavaScript (ES modules), not TypeScript
**Status:** Accepted — confirmed at Phase 0 (2026-11-06)

**Decision:** Plain JavaScript with ES modules (`"type": "module"` in every package). JSDoc `@typedef`s in `shared/` describe the shared payload shapes (entities and event payloads), and Zod gives runtime validation.
**Alternative:** TypeScript gives stronger refactoring and is a plus in interviews. Considered and declined to keep the learning curve manageable.
**Consequences:** No build step for the server or `shared/`. Editors still get autocomplete from JSDoc. Runtime safety comes from Zod at the API boundary.

## ADR-010: One transaction per mutation (`mutateBoard`)
**Status:** Accepted — amended by ADR-015 (order of writes inside the transaction)

**Context:** Without a transaction, a crash between the data write and `$inc revision` leaves a committed change that is **never announced and leaves no gap**, so clients drift apart silently.
**Decision:** Every board mutation runs `work(session)` plus `$inc revision` in `session.withTransaction()`, and publishes after the commit. That requires MongoDB to run as a replica set everywhere (Atlas in development and production, `MongoMemoryReplSet` in tests; see ADR-020).
**Alternatives:** (a) Increment first, write second, *without a transaction*: the board load can then miss changes ≤ R, because the increment can be visible before the write. (b) An outbox or change streams: more robust fan-out, but more moving parts (a stretch goal).
**Consequences:** Writes on one board are serialized through write conflicts on the board document, with automatic retries. The ceiling is roughly 100 writes per second per board, which is far above the target. `work()` must be retry-safe (database writes only).

## ADR-011: Pending-ops rebase model on the client
**Status:** Accepted — amended by ADR-016

**Decision:** Displayed state = the confirmed `base` with pending ops replayed on top, through a pure `applyOp`. The echo replaces the base, a failure drops the op, and a remote event replaces the base and replays the ops. One request in flight per entity.
**Alternatives:** One snapshot per mutation: breaks with several pending ops on the same entity, and a rollback can overwrite a teammate's change with a stale snapshot.
**Consequences:** About 150 lines of pure, heavily unit-tested reducer logic. The same engine enables undo and an offline queue later.

## ADR-012: Client-generated ObjectIds for creates
**Status:** Accepted

**Decision:** The client generates `_id`s for new lists and cards. The server validates them and treats a duplicate from the same creator as an idempotent success.
**Alternatives:** Temporary IDs replaced after the server responds: every reference (cardIdsByList, open modal, URL, chained ops) has to be rewritten.
**Consequences:** Creates are optimistic and safe to retry. The server must reject `_id`s that already belong to someone else's document.

## ADR-013: Board-level labels and client-side filtering
**Status:** Accepted

**Decision:** Labels are defined on Board and referenced by `labelIds` on cards. Filters and search run in memoized client selectors over the loaded board.
**Alternatives:** Free-text labels on each card: can't be renamed or filtered reliably. A server-side text index: unnecessary when the whole board (at most 5,000 cards) is already in memory.
**Consequences:** Deleting a label needs a cascade and a `label:deleted` event. Search across boards would need a server index later.

---

## ADR-014: Successor-based neighbor resolution (unique position keys)
**Status:** Accepted (2026-11-06)

**Context:** The server used the client's `beforeId` and `afterId` as the bounds for `between()`. Two users dropping into the same gap sent the same pair and got the *same* key, which needed a tie-break and later a rebalance.
**Decision:** The server uses `before` from the client (if usable) and takes the upper bound from the **current** list: `before`'s actual successor (excluding the moved card). If only `after` is usable, the lower bound is its actual predecessor. Appends read the current last card. Because mutations on a board are serialized (ADR-010/015), the second of two concurrent drops sees the first card and gets a distinct key.
**Alternatives:** Keep client bounds and rely on the `(position, _id)` tie-break plus a rebalance on equal keys: correct, but equal keys are a recurring edge case and add rebalance traffic.
**Consequences:** One extra indexed query per move/create. Rebalances only happen when keys grow past 50 characters. The `_id` tie-break stays as a safety net. With a filter active, the card lands directly after the visible `before`, which is still between the visible neighbors.

## ADR-015: Claim the revision first inside `mutateBoard`
**Status:** Accepted (2026-11-06) — amends ADR-010

**Context:** The board document write (`$inc revision`) is what makes two concurrent transactions on the same board conflict. When it came last, both transactions did all their work before the loser found out and retried.
**Decision:** `$inc board.revision` is the **first** operation in the transaction. A missing board → 404 immediately. Inside a transaction the order of writes doesn't change what other readers see, so atomicity and the "change ↔ revision" guarantee are unchanged.
**Alternatives:** Increment last (original): correct but wasteful under contention.
**Consequences:** Losers fail fast and retry with less wasted work. Every read in `work()` happens after the board is claimed, so mutations on one board are effectively serializable (no write skew on limits or neighbor positions).

## ADR-016: Indirect changes update the confirmed base
**Status:** Accepted (2026-11-06) — amends ADR-011

**Context:** Some events change cards without carrying the full card: `rebalanced` (positions), `member:removed` (assignee IDs), `label:deleted` (label IDs), `comment:created/deleted` (`commentCount`). If the reducer patched only the displayed card, a card with pending ops would be rebuilt from its stale base on the next replay, bringing back the deleted label or assignee or the old position.
**Decision:** In `remote.js`, every indirect change is applied to `bases[id]` when the entity has one, and the displayed entity is then recomputed by replaying its ops. It's never applied only to the displayed state.
**Consequences:** One helper (`patchConfirmed(state, id, fn)`) is used by every indirect handler. A dedicated reducer test covers each event type with a pending op that is then echoed or fails.

## ADR-017: Validated input lives on `req.valid`
**Status:** Accepted (2026-11-06)

**Context:** In Express 5, `req.query` is a read-only getter, so `validate()` can't replace it with the Zod-parsed (coerced, defaulted, stripped) value.
**Decision:** `validate({ body, params, query })` stores results on `req.valid = { body, params, query }`. Controllers read only from `req.valid`.
**Alternatives:** Mutating `req.body` and `req.params` but not `req.query`: inconsistent, and easy to read unvalidated input by accident.
**Consequences:** One consistent access path for validated input. `mongoose.set('sanitizeFilter', true)` remains as a second layer.

## ADR-018: Re-check membership after `board:join`
**Status:** Accepted (2026-11-06)

**Context:** `board:join` checked membership, then awaited `socket.join`. A removal committed in between runs `socketsLeave` *before* the socket joins, so the removed user would stay in the room and keep receiving events.
**Decision:** After `socket.join`, check membership again; if it's gone, leave the room and ack `NOT_FOUND`.
**Alternatives:** Per-event membership filtering in `publish`: costly on every broadcast.
**Consequences:** One extra indexed `exists` query per join. Closes the race for single-instance and Redis-adapter setups alike.

## ADR-019: Orphan sweep on startup
**Status:** Accepted (2026-11-06)

**Context:** Large boards are deleted by removing the Board document in the transaction and the children in batches after the commit. A crash mid-batch leaves orphaned lists, cards, and comments. They're invisible, but they waste storage forever.
**Decision:** After the database connects (without blocking `listen`), the server finds `boardId`s in `lists`, `cards`, and `comments` with no Board document, and deletes those children in batches.
**Consequences:** Idempotent and safe on every boot. On Atlas M0 (512 MB), it also keeps storage from leaking.

## ADR-020: MongoDB Atlas for development and production; in-memory replica set for tests only
**Status:** Accepted (2026-11-06)

**Context:** The design needs a replica set for transactions. The development machine has no Docker and no local `mongod`.
**Decision:** Development and production use a MongoDB Atlas M0 cluster (always a replica set). `MONGO_URI` (`mongodb+srv://…`) is read only from `server/.env` (git-ignored) and is never hardcoded. The database name comes from `MONGO_DB`: `collabboard-dev` for development, `collabboard-prod` for production. Automated tests use `MongoMemoryReplSet` from `mongodb-memory-server` and never touch Atlas. There's no local `dev:db` script and no `mongo` service in docker-compose.
**Alternatives:** (a) Docker `mongo --replSet`: requires Docker Desktop. (b) `MongoMemoryReplSet` with a persistent data folder for development: works offline, but development would diverge from production.
**Consequences:** Development needs internet access and an Atlas IP allowlist entry. Development round-trip latency to Atlas is higher than local, so the latency targets in [00](00-REQUIREMENTS.md) are measured in a deployed environment in the same region as the cluster. Use separate Atlas database users for dev and prod.

## ADR-021: `bcryptjs` instead of `bcrypt`
**Status:** Accepted (2026-11-06)

**Decision:** Hash passwords with `bcryptjs` (cost 12).
**Alternatives:** Native `bcrypt`: faster, but it needs a native build that often fails on Windows and complicates Alpine images. `argon2`: stronger, but also native.
**Consequences:** Same API and hash format, no native toolchain. Roughly 2–3× slower per hash in pure JS; at cost 12, that's acceptable for login and register, which are rate-limited anyway.

## ADR-022: Node.js 24 as the target runtime
**Status:** Accepted (2026-11-06)

**Decision:** Node 24 (Active LTS) everywhere: `engines`, `.nvmrc`, CI, and the `node:24-alpine` Docker image.
**Consequences:** Native `fetch`, `--watch`, and `node --env-file` are available. The project tracks the current LTS line instead of the maintenance one.

## ADR-023: Minimal Phase 2 client (refetch after each change)
**Status:** Accepted (2026-11-06)

**Context:** Phase 3 replaces all client-side mutation handling with the pending-ops engine. Anything clever built in Phase 2 would be thrown away.
**Decision:** In Phase 2, every client change is a plain request followed by a refetch of `GET /boards/:id`. No optimistic state, no local patching.
**Consequences:** The Phase 2 UI feels a little slower, but there's nothing to rewrite in Phase 3, and Phase 2 stays focused on the server and the data model.

## ADR-024: REST response stands in for the echo until sockets exist
**Status:** Accepted (2026-11-06), temporary until Phase 4

**Context:** In the rebase model an op is confirmed by its own socket echo (ADR-011). Phase 3 builds the ops engine before Phase 4 adds sockets, so no echo ever arrives and acked ops would never leave `ops`.
**Decision:** `boardSlice` has an `opConfirmed({ mid, entity, rebalanced })` reducer with exactly the own-echo semantics (base = confirmed entity, drop the op, replay the rest, apply `rebalanced` first). In Phase 3, `thunks.runOp` dispatches it right after `opAcked`, using the REST response.
**Consequences:** Phase 4 removes that one dispatch from `runOp`, and the event pipeline dispatches `opConfirmed` when an event's `clientMutationId` matches a pending op. The reducers and their tests stay unchanged.

---

## Documentation corrections (2026-11-06)

These fixed inconsistencies between the docs. They don't change any decision, so they don't have their own ADRs:
- [09](09-INTERVIEW-GUIDE.md) said a separate `cards:rebalanced` event is broadcast, and ADR-003 said a `*:rebalanced` event is needed. Rebalances always travel in the `rebalanced` field of the event that caused them (ADR-004).
- The health check is `GET /api/healthz` everywhere (doc 08 had `/healthz`).
- The ADRs are now in numeric order.
