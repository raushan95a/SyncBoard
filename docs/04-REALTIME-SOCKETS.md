# 04 — Real-Time (Socket.io)

## Principles

1. The server publishes **after the transaction commits**. The database is the truth, and an event only announces a committed change.
2. **One mutation → one transaction → one `revision` increment → one event**, sent to **the whole board room, including the user who made the change**.
3. Events carry the **full entity state** (an upsert), never a diff, so applying an event twice is harmless.
4. Sockets are authenticated at the handshake, and every `board:join` is checked against membership.
5. Two kinds of room:
   - `board:<boardId>`: everyone currently viewing that board.
   - `user:<userId>`: all of one user's sockets (tabs and devices), joined automatically on connect. Used for things that happen *to a user* while they aren't on the board: being added, being removed, logout everywhere.

### Why the originator receives its own event

If the server excluded the sender, the sender's revision sequence would have a gap at every one of its own changes, and it would reload the board after each one. Advancing the revision from the REST response instead is also wrong: responses and events race, and a response for rev 6 arriving before a teammate's event 5 would make the client skip event 5.

**Rule: only the socket stream advances the client's `revision`.** The REST response only confirms or rejects the client's own pending change. The echo, matched by `clientMutationId`, is what moves that change from "pending" into the confirmed state.

## Server Setup

```js
export function createIO(httpServer) {
  const io = new Server(httpServer, { maxHttpBufferSize: 1e5 });   // same origin, so no CORS
  io.use(socketAuth);
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    registerBoardHandlers(io, socket);
    registerPresenceHandlers(io, socket);
  });
  return io;
}
```

### Handshake auth

```js
export async function socketAuth(socket, next) {
  try {
    const { token } = parseCookie(socket.handshake.headers.cookie || '');   // cookie v2: import { parseCookie } from 'cookie'
    const { sub, tv } = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(sub, 'name avatarColor tokenVersion').lean();
    if (!user || user.tokenVersion !== tv) throw new Error();
    socket.data.user = { id: sub, name: user.name, avatarColor: user.avatarColor };
    next();
  } catch {
    next(new Error('UNAUTHENTICATED'));   // client: connect_error → go to /login
  }
}
```

A socket stays connected after its JWT expires; the token is only checked at the handshake. That's acceptable, because every **REST** mutation re-checks authentication, and the next reconnect fails the handshake. Logout and member removal actively evict sockets (see below).

### Join authorization

```js
socket.on(EVT.BOARD_JOIN, async ({ boardId }, ack) => {
  if (!isObjectId(boardId)) return ack?.({ error: 'BAD_REQUEST' });
  const ok = await Board.exists({ _id: boardId, 'members.userId': socket.data.user.id });
  if (!ok) return ack?.({ error: 'NOT_FOUND' });
  if (socket.data.boardId && socket.data.boardId !== boardId) await leaveBoard(socket);  // one board per socket
  await socket.join(`board:${boardId}`);
  // Re-check AFTER joining (ADR-018): if the user was removed between the first check and the
  // join, the removal's socketsLeave() ran before we joined and wouldn't have evicted us.
  if (!(await Board.exists({ _id: boardId, 'members.userId': socket.data.user.id }))) {
    socket.leave(`board:${boardId}`);
    return ack?.({ error: 'NOT_FOUND' });
  }
  socket.data.boardId = boardId;
  await emitPresence(io, boardId);
  ack?.({ ok: true });
});
```

## Publish Helper

```js
export const publish     = (boardId, event, payload) => io.to(`board:${boardId}`).emit(event, payload);
export const publishUser = (userId,  event, payload) => io.to(`user:${userId}`).emit(event, payload);
```

`publish` is called **only** by services, **only** after `mutateBoard()` returns, and **never** inside the transaction callback, which may run more than once.

### Failure analysis

| Failure | Result | Recovery |
|---------|--------|----------|
| Transaction aborts (validation error, conflict, crash) | Nothing committed, no revision used, no event | The client gets an error (or a timeout) and rolls back |
| Commit succeeds, process crashes before the emit | Revision R is committed, and no event R is ever sent | Clients see R+1 with nothing at R → after 500 ms → reload ✅ |
| Commit succeeds, the HTTP response is lost (network) | The client thinks it failed and rolls back | The echo (matching `clientMutationId`) arrives anyway and is applied, so the state is correct ✅ |
| Event lost in transit (disconnect) | The client is behind | The reconnect flow reloads ✅ |

Every case ends with the client matching the database. The transaction is what makes the first two rows true (see [02](02-DATABASE-SCHEMA.md#the-mutation-unit-of-work-read-this-first)).

## Event Catalog

Constants live in `shared/src/events.js`.

### Board room — revisioned (all carry `revision`, `actorId`, `clientMutationId?`)

| Event | Payload | Client reducer (beyond upsert) |
|-------|---------|--------------------------------|
| `card:created` | `{ card, rebalanced? }` | Skip if the card's list isn't loaded (archived) |
| `card:updated` | `{ card }` | `archived: true` → remove from view; `false` → insert |
| `card:moved` | `{ card, fromListId, rebalanced? }` | Apply `rebalanced` first, then remove from the old list and insert into the new one |
| `card:deleted` | `{ cardId, listId }` | Close the modal if it's open ("deleted by X") |
| `list:created` | `{ list, rebalanced? }` | |
| `list:updated` | `{ list }` | `archived: true` → hide the list and its cards |
| `list:moved` | `{ list, rebalanced? }` | |
| `list:deleted` | `{ listId }` | **Also remove all of its cards** from the store |
| `board:updated` | `{ board }` | Title, labels |
| `label:deleted` | `{ labelId }` | Remove the label from the board and from every card's `labelIds` |
| `member:added` | `{ member }` | |
| `member:updated` | `{ member }` | If it's me: update `myRole` (viewer → read-only UI) |
| `member:removed` | `{ userId }` | Remove the user ID from every card's `assigneeIds` |
| `comment:created` | `{ comment, commentCount }` | Update `card.commentCount`; prepend to the open modal's comments if that card is open |
| `comment:deleted` | `{ commentId, cardId, commentCount }` | Same as above, but remove |

`rebalanced` = `{ listId?, positions: { [id]: position } }` and is applied **before** the main change.

**Indirect changes must reach the confirmed base (ADR-016).** `rebalanced`, `member:removed`, `label:deleted`, `comment:created`, and `comment:deleted` change cards that the event doesn't carry in full. For a card that has pending ops (it has an entry in `bases`), apply the change to **both** the base and the displayed card, then replay its ops. Updating only the displayed card is a bug: the next replay rebuilds it from the stale base and brings back the removed label or assignee, or the old position.

### Board room — not revisioned (handled immediately, outside the ordered stream)

| Event | Payload | Notes |
|-------|---------|-------|
| `presence:update` | `{ users: [{id, name, avatarColor}] }` | Deduplicated by user |
| `card:editing` | `{ cardId, user, editing }` | Advisory only |
| `board:deleted` | `{ boardId, actorName }` | Terminal: leave the page, go to `/boards`, toast "Board deleted by X" |

### User room

| Event | Payload | Client reaction |
|-------|---------|-----------------|
| `boards:changed` | `{ boardId, reason: 'added' \| 'removed' \| 'renamed' \| 'deleted' \| 'created' }` | Refetch `/boards` if the boards page is mounted |
| `board:access-revoked` | `{ boardId }` | If viewing that board: go to `/boards` and toast "You were removed from X" |
| `session:revoked` | — | Clear the store and go to `/login` (logout everywhere) |

### Client → Server

| Event | Payload | Notes |
|-------|---------|-------|
| `board:join` | `{ boardId }` + ack | Authorized. One board per socket. |
| `board:leave` | `{ boardId }` | |
| `card:editing:start` | `{ cardId }` | Relayed only within `socket.data.boardId`'s room |
| `card:editing:heartbeat` | `{ cardId }` | Every 10 s. The server expires the indicator after 30 s without one. |
| `card:editing:stop` | `{ cardId }` | Also sent automatically on `disconnecting` |

Throttle short-lived events to 5 per second per socket. The "X is editing…" indicator is advisory; the real protection is the `409`.

## Client Event Pipeline

```
socket ─► [ paused? (loading or dragging) → buffer ] ─► [ revision check / reorder ] ─► apply to base ─► rebase pending ops
```

### 1. Initial load and reconnect (avoid the join-versus-fetch race)

```
connect → emit board:join (await ack) → pipeline.pause()
        → GET /boards/:id → snapshot with revision R
        → pipeline.resetTo(snapshot): drop buffered events ≤ R, apply the rest in order
        → pipeline.resume()
```

**Join before fetching.** Otherwise a change committed between the fetch and the join would be lost.

### 2. Revision check and reorder buffer

```js
function onRevisionedEvent(evt) {
  if (paused) return buffer.push(evt);
  const { revision } = getState().board.meta;
  if (evt.revision <= revision) return;                    // duplicate or already in the snapshot
  if (evt.revision === revision + 1) { apply(evt); drainReorderBuffer(); return; }
  reorder.set(evt.revision, evt);                          // arrived early
  armGapTimer(500);                                        // still missing after 500 ms → resync()
}
```

Two concurrent transactions can commit as 6 and then 7 but emit 7 first. A short reorder buffer absorbs that without a reload.

### 3. Pause during drag

While a drag is in progress, **all** revisioned events are buffered, and the gap timer doesn't run. The drag library breaks if lists change under the pointer. Drags last a few seconds at most. On drop, the client applies its optimistic move, then resumes and drains the buffer. A `resync()` requested during a drag runs when the drag ends.

### 4. Resync

`resync()` = pause → `GET /boards/:id` → replace the confirmed state with the snapshot → drop buffered events ≤ R → re-apply pending ops on top (see [05](05-FRONTEND.md#pending-operations-optimistic-ui-done-right)) → resume. At most one resync runs at a time.

## Logout, Revocation, Membership

```js
// logout everywhere
await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
publishUser(userId, EVT.SESSION_REVOKED);
io.in(`user:${userId}`).disconnectSockets(true);

// member removed (after commit)
publish(boardId, EVT.MEMBER_REMOVED, { userId, revision, actorId });
publishUser(userId, EVT.ACCESS_REVOKED, { boardId });
publishUser(userId, EVT.BOARDS_CHANGED, { boardId, reason: 'removed' });
io.in(`user:${userId}`).socketsLeave(`board:${boardId}`);
```

`socketsLeave` and `disconnectSockets` work across instances when the Redis adapter is in use.

## Scaling to Multiple Instances (Phase 8)

1. Redis adapter:
```js
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
const pub = createClient({ url: env.REDIS_URL });
const sub = pub.duplicate();
await Promise.all([pub.connect(), sub.connect()]);
io.adapter(createAdapter(pub, sub));
```
2. **Sticky sessions** on the load balancer (long-polling needs them), or `transports: ['websocket']` on the client.
3. The revision counter stays correct across instances, because transactions in MongoDB serialize writes per board. Events from different instances can arrive in a different order, and the reorder buffer absorbs that.

## Presence

Compute presence from `io.in(room).fetchSockets()`, deduplicated by `user.id`, and emit it on join, leave, and `disconnecting`. Recompute and send the full list each time; for a 50-user board, that's cheap. At larger scale, keep a Redis hash per board and send changes instead.
