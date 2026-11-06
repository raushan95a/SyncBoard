# 01 — Architecture

## Goals

- Under 100 ms perceived latency for drag-and-drop, using optimistic UI.
- **Convergence:** all clients end up with the same state as the database, even with concurrent edits, reordered events, or dropped connections.
- Simple enough to explain end to end on a whiteboard in five minutes.

## Dual-Channel Design

| Channel | Used for | Direction |
|---------|----------|-----------|
| HTTP (REST) | All data changes and initial loads | client → server |
| WebSocket | Change notifications, presence, editing indicators | server → clients (mostly) |

**Rule:** the only socket events a client sends to the server are `board:join`, `board:leave`, and short-lived presence events (`card:editing:start|stop|heartbeat`). Data changes never travel from a client over the socket.

Why not send mutations over the socket? REST gives you status codes, validation middleware, rate limiting, retries, and easy testing. The socket then does one job: fanning out changes.

## Component Diagram

```
                    same origin (Vite proxy in dev / reverse proxy in prod)
 ┌──────────────┐  ─────────────────────────────────────────────────────────
 │ React + RTK  │ ──REST /api──►  Express routes ─► services ─► Mongoose ─► MongoDB
 │              │                                     │
 │ event        │                                     │ after successful write:
 │ pipeline     │ ◄──Socket.io /socket.io──  broadcaster: $inc board.revision,
 └──────────────┘                            io.to(`board:${id}`).emit(...)
                                                      │
                                       (Phase 8) Redis adapter ◄──► other instances
```

## Monorepo Layout (npm workspaces)

```
syncboard/
├── shared/src/
│   ├── events.js           # export const EVT = { CARD_MOVED: 'card:moved', ... }
│   ├── position.js         # thin wrapper around fractional-indexing + compare()
│   ├── roles.js            # role → permission map
│   └── schemas/            # zod schemas reused by server validation and client forms
├── server/src/
│   ├── index.js            # bootstrap http + socket, graceful shutdown
│   ├── app.js              # express app, middleware order
│   ├── config/             # env (validated with zod), db, redis
│   ├── models/             # User, Board, List, Card, Comment
│   ├── routes/             # auth, boards, lists, cards, comments
│   ├── controllers/        # thin: parse → service → respond
│   ├── services/           # business rules, persistence, broadcast
│   ├── middleware/         # auth, validate, loadResource, requireRole, error
│   ├── sockets/            # io setup, handshake auth, handlers, presence
│   └── utils/              # ApiError, logger
└── client/src/             # see docs/05
```

**Why `shared/`?** The client and server must agree exactly on event names, validation rules, and how position strings compare. A typo in an event name is a silent bug that's hard to trace. A shared constant turns it into an import error.

**Layering rules**
- Controllers never touch Mongoose directly. Services never touch `req`/`res`.
- Services are the **only** place that calls `publish(boardId, event, payload)`.
- Express 5 forwards rejected promises to the error handler, so there's no need for an `asyncHandler` wrapper.

## Card Move Lifecycle (the interview story)

1. The user drops a card, which fires `onDragEnd`.
2. The client works out `beforeId`/`afterId` (the neighbors in the destination list), computes a provisional `position`, and dispatches `cardMovedOptimistic` with a new `clientMutationId`. The UI updates right away, and the previous state is saved as a snapshot.
3. The client sends `PATCH /api/cards/:id/move` with `{ toListId, beforeId, afterId, clientMutationId }`.
4. The server checks the user's role. Then, in **one MongoDB transaction** (`mutateBoard`), it:
   - claims the next `board.revision` (first write, so concurrent mutations on this board serialize immediately),
   - resolves the neighbors (ignoring any that are stale) and uses `before`'s **current successor** in the list as the upper bound, so the key is unique,
   - rebalances the list if the key would get too long,
   - computes the authoritative `position`,
   - and updates the card.
5. **After the commit**, the server emits `card:moved { card, fromListId, rebalanced?, revision, actorId, clientMutationId }` to the **whole** room `board:<id>`, then returns `{ card, revision }`.
6. **The originating client:**
   - The REST response marks the pending op as *acked*.
   - The echo event (matching `clientMutationId`) becomes the new confirmed state, the op is removed, and the revision advances.
   - On an error response, the op is removed, and the card returns to its last confirmed state with a toast.
7. **Other clients** apply `card:moved` through the same ordered event pipeline. If they have their own pending ops on that card, those are replayed on top (the rebase model, see [05](05-FRONTEND.md#pending-operations-optimistic-ui-done-right)).

Every other feature follows this same pattern. All of them are traced in [11-FEATURE-WORKFLOWS](11-FEATURE-WORKFLOWS.md).

## Consistency Model

| Problem | Mechanism | Doc |
|---------|-----------|-----|
| Data write and revision increment must not separate | One MongoDB transaction per mutation (`mutateBoard`); publish after commit | 02 |
| Ordering without rewriting siblings | Fractional string positions; a move writes one document | 02 |
| Two users drop into the same gap | Mutations on one board are serialized, and the server places a card between `before` and its *current* successor, so the second drop gets a different key. `(position, _id)` tie-break stays as a safety net. | 02, 03 |
| Two users edit the same description | Compare-and-set on `version` → `409` → three-way auto-merge or conflict banner | 02, 05 |
| Toggles, dates, labels, assignees | Last-write-wins `$set` / commutative `$addToSet`/`$pull` | 02 |
| Events arrive out of order | Client reorder buffer keyed by `revision` | 04 |
| Missed events (disconnect, crash after commit) | Gap timeout → reload the board | 04 |
| Remote change to an entity with pending local ops | Rebase: confirmed state = event, then replay the pending ops | 05 |
| Indirect changes (`rebalanced`, `member:removed`, `label:deleted`, `comment:*`) to an entity with pending ops | Apply the change to the confirmed base too, then replay | 05 |
| Several queued ops on one entity | One request in flight per entity; ops replayed in order | 05 |
| Optimistic creates | Client-generated ObjectIds, so there's no temporary ID to swap | 02 |
| Reconnect | Re-join, pause, reload, rebase the pending ops, resume | 04 |
| Membership revoked or logout everywhere | `user:<id>` room for events and socket eviction | 04 |

The guarantee: **each card converges to the latest committed server state, and no text edit is silently overwritten.** The project doesn't promise intent-preserving merges, because that needs CRDTs (see [10](10-DECISION-LOG.md)).

## Express Middleware Order

```
helmet → requestId + logger → express.json({ limit: '100kb' }) → cookieParser
→ rateLimit → /api/auth routes → auth → /api routes → 404 → errorHandler
```

## Non-Functional Targets

See [00-REQUIREMENTS](00-REQUIREMENTS.md#non-functional-requirements).
