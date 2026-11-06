# 03 — REST API Specification

Base URL: `/api` (same origin as the client). JSON only. Authentication is the HTTP-only cookie `token`. Mutations require `Content-Type: application/json`.

## Conventions

**Success:** `200`/`201` with `{ "data": ... }`. Board mutations also return `revision` and echo back `clientMutationId`.

**Error:**
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Title is required", "details": [] } }
```

| Status | Code | Meaning | Client reaction |
|--------|------|---------|-----------------|
| 400 | VALIDATION_ERROR | Bad input (Zod) | Roll back, toast |
| 401 | UNAUTHENTICATED | Missing, invalid, or revoked token | Clear the store, go to `/login` |
| 403 | FORBIDDEN | Member, but the role isn't allowed | Roll back, toast, refresh role |
| 404 | NOT_FOUND | Missing resource. **Also returned to non-members.** | Roll back, toast "was deleted" |
| 409 | CONFLICT | Stale `version` (body has `details.current`), or duplicate | Merge or show the conflict banner |
| 413 | PAYLOAD_TOO_LARGE | Body over 100 kB | Toast |
| 415 | UNSUPPORTED_MEDIA_TYPE | Mutation without a JSON content type (CSRF defense) | — (bug) |
| 422 | LIMIT_REACHED | A hard limit from [02](02-DATABASE-SCHEMA.md#hard-limits-validated-in-services) | Roll back, toast |
| 429 | RATE_LIMITED | Too many requests | Roll back, toast, back off |

Every board mutation accepts an optional `clientMutationId` (a nanoid). The server copies it into the event so the originating client can recognize its own change.

**Every board mutation runs inside `mutateBoard()`** (see [02](02-DATABASE-SCHEMA.md#the-mutation-unit-of-work-read-this-first)) and publishes exactly one event after the commit.

## Auth

| Method | Path | Body | Notes |
|--------|------|------|-------|
| POST | `/auth/register` | `{name, email, password}` | Sets the cookie, returns the user |
| POST | `/auth/login` | `{email, password}` | Sets the cookie. The error is always "Invalid email or password". |
| POST | `/auth/logout` | `{ everywhere?: boolean }` | Clears the cookie. If `everywhere`: `$inc tokenVersion` and disconnect all of the user's sockets. |
| GET | `/auth/me` | — | Current user, or 401 |

Password: 8–128 characters, hashed with `bcryptjs` (cost 12).

## Boards

| Method | Path | Min role | Body / response | Event |
|--------|------|----------|-----------------|-------|
| GET | `/boards` | — | `[{ _id, title, myRole, updatedAt }]` | — |
| POST | `/boards` | — | `{title, template?: 'basic' \| 'empty'}`. `basic` creates To Do / Doing / Done. | `boards:changed` to the creator's user room |
| GET | `/boards/:id` | viewer | `{ board, lists, cards, revision }` | — |
| GET | `/boards/:id/archived` | viewer | `{ lists, cards }` (archived only, newest first) | — |
| PATCH | `/boards/:id` | owner | `{title}` | `board:updated` + `boards:changed` to members' user rooms |
| DELETE | `/boards/:id` | owner | — | `board:deleted` + `boards:changed` |

## Members

| Method | Path | Min role | Body | Event |
|--------|------|----------|------|-------|
| POST | `/boards/:id/members` | owner | `{email, role}`. 404 "No account with that email" if not registered; 409 if already a member. | `member:added`; `boards:changed` to the new member's user room |
| PATCH | `/boards/:id/members/:userId` | owner | `{role}`. 422 if it would leave zero owners. | `member:updated` |
| DELETE | `/boards/:id/members/:userId` | owner, or self | 422 if they're the last owner | `member:removed { userId }`; `board:access-revoked` to the removed user's room |

## Labels

| Method | Path | Min role | Body | Event |
|--------|------|----------|------|-------|
| POST | `/boards/:id/labels` | editor | `{name, color}` | `board:updated` |
| PATCH | `/boards/:id/labels/:labelId` | editor | `{name?, color?}` | `board:updated` |
| DELETE | `/boards/:id/labels/:labelId` | editor | Also removes the label from all cards | `label:deleted { labelId }` |

## Lists

| Method | Path | Min role | Body | Event |
|--------|------|----------|------|-------|
| POST | `/boards/:boardId/lists` | editor | `{_id?, title, clientMutationId?}`. Appended to the end. | `list:created` |
| PATCH | `/lists/:id` | editor | `{title?, archived?}` (last-write-wins). Restoring appends to the end. | `list:updated` |
| PATCH | `/lists/:id/move` | editor | `{beforeId?, afterId?, clientMutationId?}` | `list:moved` |
| DELETE | `/lists/:id` | editor | Cascades to its cards and comments | `list:deleted` |

## Cards

| Method | Path | Min role | Body | Event |
|--------|------|----------|------|-------|
| POST | `/lists/:listId/cards` | editor | `{_id?, title, clientMutationId?}`. Appended to the end. | `card:created` |
| GET | `/cards/:id` | viewer | `{ card, comments: firstPage, nextCursor }` | — |
| PATCH | `/cards/:id/content` | editor | `{title?, description?, version}`. **Compare-and-set.** | `card:updated` |
| PATCH | `/cards/:id` | editor | `{completed?, dueDate?, archived?}` (last-write-wins) | `card:updated` |
| POST | `/cards/:id/assignees` | editor | `{userId}` → `$addToSet`. 400 if not a board member. | `card:updated` |
| DELETE | `/cards/:id/assignees/:userId` | editor | `$pull` | `card:updated` |
| POST | `/cards/:id/labels` | editor | `{labelId}` → `$addToSet`. 400 if it's not one of this board's labels. | `card:updated` |
| DELETE | `/cards/:id/labels/:labelId` | editor | `$pull` | `card:updated` |
| PATCH | `/cards/:id/move` | editor | `{toListId, beforeId?, afterId?, clientMutationId?}` | `card:moved` |
| DELETE | `/cards/:id` | editor | Also deletes its comments | `card:deleted` |

**Restoring an archived card** (`PATCH { archived: false }`): if its list still exists and isn't archived, the card is appended to the end of that list with a fresh position. If its list is archived, the request returns 422 "Restore the list first". If its list was deleted, the card no longer exists either (deletes cascade).

**Create idempotency:** if the client-supplied `_id` already exists and `createdBy` is the caller, return 200 with the existing document. If someone else created it, return 409.

### Move Semantics

- `beforeId` is the card **above** the drop point and `afterId` the card **below** it, taken from the list as the user **saw it**: with any filters applied and the dragged card removed.
- The server resolves the neighbors (see [02](02-DATABASE-SCHEMA.md#neighbor-resolution-unique-keys-adr-014)):
  - Neighbor on **another board** → `400` (tampering).
  - Neighbor archived, deleted, or **no longer in `toListId`** (a concurrent move) → ignore it, and place the card relative to the remaining neighbor. If neither is usable, append to the end. *Don't reject a stale neighbor:* the user's intent is still valid.
  - The upper bound is `before`'s **current successor** in the list, not the client's `afterId`. This keeps keys unique under concurrent drops into the same gap.
  - `toListId` missing, archived, or on another board → `404`.
- `position = between(before?.position, after?.position)`. If the new key is longer than 50 characters (or, defensively, `before.position >= after.position`) → `rebalanceList()` in the same transaction, then compute again.
- Moving to the same list and the same neighbors is a no-op on the client. It never reaches the server.

```js
// services/cardService.move — simplified
const { card, fromListId, rebalanced, revision } = await mutateBoard(boardId, async (session) => {
  const toList = await List.findOne({ _id: toListId, boardId, archived: false }).session(session);
  if (!toList) throw new ApiError(404, 'NOT_FOUND');
  // before = client's beforeId if usable; after = before's CURRENT successor (not the client's afterId)
  let [before, after] = await resolveNeighbors({ boardId, toListId, cardId, beforeId, afterId, session });
  let rebalanced;
  if (needsRebalance(before, after)) {
    rebalanced = await rebalanceList(toListId, session);
    [before, after] = await resolveNeighbors({ /* same args */ });
  }
  const prev = await Card.findOne({ _id: cardId, boardId }).session(session);
  if (!prev) throw new ApiError(404, 'NOT_FOUND');
  const card = await Card.findByIdAndUpdate(cardId,
    { $set: { listId: toListId, position: between(before?.position, after?.position) } },
    { new: true, session });
  return { card, fromListId: prev.listId, rebalanced };
});
publish(boardId, EVT.CARD_MOVED, { card, fromListId, rebalanced, revision, actorId, clientMutationId });
res.json({ data: { card, revision, clientMutationId } });
```

## Comments

| Method | Path | Min role | Body | Event |
|--------|------|----------|------|-------|
| GET | `/cards/:cardId/comments?cursor=&limit=20` | viewer | Newest first; cursor is the last `_id` | — |
| POST | `/cards/:cardId/comments` | editor | `{body}` → `{ comment, commentCount }` | `comment:created` |
| DELETE | `/comments/:id` | author or owner | → `{ commentCount }` | `comment:deleted` |

Comment editing is out of scope for the MVP.

## Health

`GET /api/healthz` returns `200 { ok: true, db: 'up', instance: <hostname> }`.

## Rate Limits

- `/auth/login`, `/auth/register`: 10 requests per 15 minutes per IP
- Everything else: 300 requests per minute per user

## Validation

Zod schemas live in `shared/src/schemas/` and are reused by the client forms. The `validate({ body, params, query })` middleware applies them as strict objects (`z.strictObject`). Every ID (path parameter, body ID, or client-supplied `_id`) is checked as an ObjectId before any query runs.

Parsed values are stored on **`req.valid = { body, params, query }`**, and controllers read only from there (ADR-017). In Express 5, `req.query` is a read-only getter, so the parsed (coerced, defaulted) query can't be written back onto it.
