# 09 — Interview Guide

How to present SyncBoard so it comes across as **senior-level**: you made deliberate trade-offs, you know where the design breaks, and you have measurements to back it up.

## The 60-Second Pitch

> "SyncBoard is a real-time Kanban board: React, Redux Toolkit, Node, Socket.io, and MongoDB. The interesting part is consistency. All writes go through REST, and the server broadcasts only after the database commit. Each broadcast carries a per-board revision number, so clients apply events in order, buffer events that arrive early, and reload if one goes missing. Drags are optimistic and roll back on failure. Order is stored as fractional-index strings, so a move updates one document. Text edits use compare-and-set versioning, so concurrent edits produce a conflict instead of silent data loss. I measured a p95 propagation of __ ms with 50 clients, and moving a card re-renders only three components."

Fill in the blanks with your real numbers from Phase 7 and Phase 8.

## The Whiteboard Diagram

Draw the [Card Move Lifecycle](01-ARCHITECTURE.md#card-move-lifecycle-the-interview-story): client → REST → service → DB → `$inc revision` → room broadcast → both clients. Then point out the three failure points:
1. The REST call fails → rollback.
2. An event arrives out of order → reorder buffer.
3. An event is lost → gap timeout → reload.

## Where I Deliberately Deviated From the "Standard Tutorial" Design

This table is your strongest material. It shows you didn't just follow a blog post.

| Common tutorial approach | What SyncBoard does | Why |
|--------------------------|---------------------|-----|
| `listIds[]` on Board and `cardIds[]` on List to keep order | A `position` string on each card or list | Arrays create two sources of truth: a crash between the card write and the array write corrupts order, and every move rewrites a hot array. |
| Integer orders with gaps (1024, 2048, then 1536) | Fractional-index **strings** | Integer gaps run out after about 10 inserts at the same spot. String keys never run out; they only grow, and an occasional rebalance fixes that. |
| The client emits `card_moved` over the socket *and* calls REST | The client calls REST only; the **server** emits after the commit | If the client emits, other users can see a move that then fails to save. It also lets clients forge events, and creates two code paths that disagree. |
| Broadcast excludes the sender | Broadcast to the whole room, with `clientMutationId` | Keeps every client's revision sequence gap-free, and the sender's echo doubles as its confirmation. |
| Mongoose `__v` / `optimisticConcurrency` for conflicts | Explicit `{ _id, version }` compare-and-set filter | `optimisticConcurrency` only covers the few milliseconds inside one request, not the 30 seconds the user spent reading an older copy. |
| `userIds`/`workspaceIds` arrays on User *and* `memberIds` on Board | Membership stored only on Board | One source of truth, so nothing can drift out of sync. |
| Comments embedded in Card | A separate collection | Comments grow without limit; paginate them. |

## Likely Questions and Strong Answers

**Q: Why not embed cards inside lists?**
A list document would grow without limit (the 16 MB cap), every card edit would rewrite the whole list document, and two users editing different cards in the same list would contend on one document. Separate collections plus a denormalized `boardId` on Card give single-document writes and a board load that takes one query per collection.

**Q: Two users drag different cards into the same gap at the same moment. What happens?**
Every mutation writes the board document first, so the two transactions are serialized: one commits, the other hits a write conflict and is retried. The server doesn't trust the client's `afterId` as the upper bound; it places the card between `before` and `before`'s *current* successor. On the retry, that successor is the card that just landed, so the second card gets a different key. Sorting by `(position, _id)` is kept as a safety net. If a key ever gets too long, the server rebalances the list in the same transaction, and the `rebalanced` positions ride along in that same `card:moved` event.

**Q: Two users drag the *same* card.**
Last write wins. Both moves commit, and each increments the revision. Every client applies both events in revision order and ends up at the later position. The user whose move was overwritten sees the card move, because their pending mutation was confirmed first and then the later event was applied. That's acceptable for card position. For text, we use compare-and-set instead.

**Q: Two users edit the same description.**
The second save gets a `409` containing the current version. The UI offers "see theirs", "keep mine", or "copy my text". The "Alice is editing" indicator makes conflicts rare, but it's only advisory. The `409` is what actually guarantees correctness. *Follow-up:* "Why not merge?" Merging needs a CRDT such as Yjs. That's a lot of added complexity for a description field. I'd add it if descriptions became long, shared documents (see ADR-006).

**Q: How do you know a client didn't miss an event?**
Every mutation increments `board.revision` by exactly one **in the same transaction as the data write**, and emits exactly one event after the commit. A client expects `revision + 1`. If an event arrives early, it's buffered for 500 ms. If the gap is still there, the client reloads the board. A crash after the commit but before the emit leaves a gap, which the client detects.

**Q: Why a transaction? Couldn't you just write and then increment?**
If the process crashed between the two, the change would be committed but never announced, *and there'd be no gap*, so clients would stay out of sync with no way to notice. The transaction makes "data changed" and "revision used" one atomic fact. As a bonus, write conflicts on the board document serialize mutations, so revision order equals commit order.

**Q: Your teammate edits a card while your move of it is still in flight. What do you see?**
I use a rebase model. The client keeps the last confirmed state as the base, plus my pending ops. The teammate's event replaces the base, and my move op is replayed on top. So I see their new description *and* my card in its new spot. When my echo arrives, the op is removed. If my request fails instead, the op is removed, and I fall back to the *latest* confirmed state, not a stale snapshot that would wipe out their edit.

**Q: How do optimistic creates work without temporary IDs?**
The client generates the MongoDB ObjectId itself. The card is immediately draggable and editable, follow-up requests are chained behind the create, and retries are idempotent: the same `_id` from the same creator returns 200.

**Q: Why does the sender receive its own event?**
So its revision sequence has no gaps, and so the echo can confirm the optimistic change. If the REST response advanced the revision instead, it could skip a teammate's event that was still on its way.

**Q: What happens on reconnect?**
The client re-joins the room *first*, buffers incoming events, reloads the board (getting revision R), drops buffered events with revision ≤ R, and applies the rest. Joining before fetching closes the window where a change could slip through.

**Q: How does this scale horizontally?**
Socket.io rooms are kept in memory per process, so I add the Redis adapter for cross-instance fan-out and sticky sessions for long-polling. The revision counter is incremented inside a MongoDB transaction, so it's already correct across instances. Next bottleneck: every mutation on a board writes one Board document, so writes per board are serialized. That's fine up to roughly 100 writes per second per board. Beyond that, I'd use an outbox or change streams for fan-out, with a sequence number per entity instead of per board.

**Q: How did you keep React fast?**
Normalized state, so a move touches one card object and two ID arrays. Memoized `CardItem` and `ListColumn` components that select by ID. Reducers return the same reference for anything they didn't change. I have a render-count test proving that moving one card re-renders only the moved card and two columns.

**Q: JWT in localStorage or a cookie?**
An HTTP-only cookie, so XSS can't read it. That means I have to handle CSRF: `SameSite=Lax` plus a required JSON content type. I deploy on one origin so the cookie never becomes third-party. I added `tokenVersion` so logout actually revokes sessions.

**Q: What would you do differently or next?**
Pick one or two: a transactional outbox or change streams to decouple writes from fan-out; Yjs for descriptions; an offline queue keyed by `clientMutationId` (it already works as an idempotency key); per-board Redis presence.

## Demo Script (3 minutes)

1. Open two browsers side by side, logged in as Alice and Bob.
2. Alice drags a card, and it appears in Bob's window immediately.
3. Both edit the same description, and Bob gets the conflict banner.
4. Stop the server, and both show "Reconnecting…". Restart it, and both resync.
5. Open DevTools → React Profiler → move a card → show that only three components highlight.
6. Remove Bob from the board, and Bob's view is closed with "Access revoked".

## Numbers to Have Ready

- p95 propagation latency at 50 clients: ___ ms
- Board load time for 500 and 2,000 cards: ___ ms / ___ ms
- Components re-rendered per card move: 3
- Test count and coverage: ___
