# 02 — Database Schema

MongoDB (Atlas M0) with Mongoose 9, running as a **replica set** (required for transactions, see below). Collections are **normalized**: cards are not embedded in lists. This avoids large documents, write contention on a single hot document, and the 16 MB document limit.

```
User ─┐
      │ members[] (on Board only)
Board ─┬─< List ─< Card ─< Comment
  │    └──────────< Card            (boardId denormalized on Card and Comment)
  └─ labels[] ◄── Card.labelIds[]
```

## Hard Limits (validated in services)

| Limit | Value | Why |
|-------|-------|-----|
| Members per board | 100 | Members are embedded in Board |
| Labels per board | 20 | Embedded in Board |
| Lists per board | 100 | Keeps the UI usable |
| Cards per board (not archived) | 5,000 | The whole board loads in one request |
| Title / description / comment | 200 / 10,000 / 5,000 characters | Payload size |

## The Mutation Unit of Work (read this first)

Every change to board data must do two things **atomically**:
1. `$inc board.revision`, **first** (ADR-015).
2. Write the data (card, list, board, and so on).

The event is published **after the commit**.

```js
// services/mutateBoard.js
export async function mutateBoard(boardId, work) {
  const session = await mongoose.startSession();
  let result, revision;
  try {
    await session.withTransaction(async () => {
      // FIRST: claim the revision. This write to the board document is what serializes
      // concurrent mutations on one board, so doing it first makes a loser fail fast.
      const board = await Board.findByIdAndUpdate(
        boardId, { $inc: { revision: 1 } },
        { returnDocument: 'after', session, projection: 'revision' });
      if (!board) throw new ApiError(404, 'NOT_FOUND');
      revision = board.revision;
      result = await work(session);                       // every query passes { session }
    });
  } finally {
    await session.endSession();
  }
  return { ...result, revision };                         // caller publishes AFTER this returns
}
```

**Why a transaction is required:**

| Crash or failure point | Without a transaction | With a transaction |
|------------------------|----------------------|--------------------|
| After `$inc`, before the data write | Revision used up, data missing | Both roll back ✅ |
| After the data write, before commit | Change committed but **never announced, and no gap is visible**. Clients stay out of sync silently. ❌ | Both roll back ✅ |
| After commit, before emit | Gap → clients reload ✅ | Gap → clients reload ✅ |

Side benefits:
- **Revision order matches commit order.** Two concurrent transactions on one board both write the board document. MongoDB raises a write conflict, and `withTransaction` retries the loser automatically. Because the board write comes first, the loser conflicts *before* doing its work, not after.
- **Mutations on one board are serializable.** Every mutation writes the board document, so no two can commit from the same snapshot. Reads inside `work()` (neighbors, counts for limits) can't go stale before commit.
- `work()` may **run more than once** on retry, so it must only do database writes. No `publish()`, no external calls, nothing outside the session.
- Cost: mutations on one board are effectively serialized. That's fine for up to about 100 writes per second per board (see [09](09-INTERVIEW-GUIDE.md) for the scaling answer).

Environment setup: development and production use **MongoDB Atlas** (always a replica set), with separate databases `collabboard-dev` and `collabboard-prod`. Automated tests use `MongoMemoryReplSet` and never touch Atlas (ADR-020).

## Ordering: Fractional Indexing

Every list and card has a `position` **string**:

```js
// shared/src/position.js
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

export const between = (a, b) => generateKeyBetween(a ?? null, b ?? null);
export const seed    = (n) => generateNKeysBetween(null, null, n);
export const MAX_KEY_LEN = 50;

// Plain code-unit comparison — NEVER localeCompare (it would disagree with MongoDB's sort).
export const comparePos = (x, y) =>
  x.position < y.position ? -1 : x.position > y.position ? 1 :
  x._id < y._id ? -1 : x._id > y._id ? 1 : 0;
```

- A move writes **one** document.
- There are no `cardIds`/`listIds` arrays, so there's one source of truth for order.
- Sort with `{ position: 1, _id: 1 }` on the server and `comparePos` on the client. They agree exactly, because MongoDB's default binary collation matches JS `<` for these ASCII keys. Don't set a locale collation.

### Neighbor resolution (unique keys, ADR-014)

The client sends neighbor IDs from the list as it saw it. The server doesn't trust `afterId` as the upper bound; it uses the **current** list:

- `before` usable → `after` = the first non-archived card in `toListId` that sorts after `before` (excluding the card being moved).
- only `after` usable → `before` = the last card that sorts before `after`.
- neither usable → append: `before` = the current last card, `after` = `null`.

Since mutations on one board are serialized, two users dropping into the same gap get *different* keys: the second one sees the first card as `before`'s successor. With a filter active, hidden cards may sit between the visible neighbors; the card lands directly after `before`, which is still between the visible neighbors.

### Rebalance (inside the same transaction)

Trigger: the newly generated key would be longer than `MAX_KEY_LEN`. A defensive second trigger, `before.position >= after.position`, should never fire with successor-based resolution, but stays in case of legacy or hand-edited data.

```js
async function rebalanceList(listId, session) {
  const cards = await Card.find({ listId, archived: false }).sort({ position: 1, _id: 1 })
    .select('_id').session(session).lean();
  const keys = seed(cards.length);
  await Card.bulkWrite(cards.map((c, i) => ({
    updateOne: { filter: { _id: c._id }, update: { $set: { position: keys[i] } } },
  })), { session });
  return { listId, positions: Object.fromEntries(cards.map((c, i) => [String(c._id), keys[i]])) };
}
```

A rebalance always happens **as part of** the move or create that needed it, so it's the same transaction, the same revision, and **the same event**. The event payload carries an optional `rebalanced: { listId, positions }` field, which clients apply *before* the main change. This keeps the rule "one mutation → one revision → one event".

Archived cards keep their old position and get a fresh one when restored (see the restore flow in [11](11-FEATURE-WORKFLOWS.md)).

## Client-Generated IDs

The client creates `_id`s for **new lists and cards** with `bson-objectid` and sends them in the create request:
- An optimistic create needs no temporary ID that later has to be swapped for the server's ID. The card is draggable, editable, and openable immediately.
- Retries are idempotent. A duplicate-key error (`E11000`) on `_id` from the same creator → return the existing document with 200. From someone else → 409.
- The server validates the format. It's an ObjectId, so it can't be used for injection.

## User

```js
const userSchema = new Schema({
  name:         { type: String, required: true, trim: true, maxlength: 80 },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  avatarColor:  { type: String, default: '#6366f1' },
  tokenVersion: { type: Number, default: 0 },     // bump → revokes all sessions
}, { timestamps: true });
```
Index: `email` (unique).

Membership lives **only on Board**. To get "my boards", query `Board.find({ 'members.userId': me })`.

## Board

```js
export const LABEL_COLORS = ['green','yellow','orange','red','purple','blue','sky','lime','pink','gray'];

const boardSchema = new Schema({
  title:     { type: String, required: true, trim: true, maxlength: 120 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },   // informational only
  members: [{
    _id: false,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role:   { type: String, enum: ['owner', 'editor', 'viewer'], default: 'editor' },
  }],
  labels: [{                                              // _id auto-generated
    name:  { type: String, trim: true, maxlength: 30, default: '' },
    color: { type: String, enum: LABEL_COLORS, required: true },
  }],
  revision: { type: Number, default: 0 },
}, { timestamps: true });
```
Index: `{ 'members.userId': 1 }`.

- **Permissions come only from `members[].role`.** There's no `ownerId` field, because a second "owner" field could disagree with the roles. A board may have several owners, and the last owner can't leave or be demoted.
- Labels are defined **once per board**, and cards refer to them by ID. Renaming or recoloring a label updates every card, and filtering by label is trivial.
- A new board gets a default palette of six unnamed colored labels.

## List

```js
const listSchema = new Schema({
  boardId:  { type: Schema.Types.ObjectId, ref: 'Board', required: true },
  title:    { type: String, required: true, trim: true, maxlength: 120 },
  position: { type: String, required: true },
  archived: { type: Boolean, default: false },
}, { timestamps: true });
```
Index: `{ boardId: 1, archived: 1, position: 1, _id: 1 }`.

## Card

```js
const cardSchema = new Schema({
  boardId:      { type: Schema.Types.ObjectId, ref: 'Board', required: true },
  listId:       { type: Schema.Types.ObjectId, ref: 'List',  required: true },
  title:        { type: String, required: true, trim: true, maxlength: 200 },
  description:  { type: String, default: '', maxlength: 10000 },
  position:     { type: String, required: true },
  version:      { type: Number, default: 0 },          // bumps ONLY on title/description
  assigneeIds:  [{ type: Schema.Types.ObjectId, ref: 'User' }],
  labelIds:     [{ type: Schema.Types.ObjectId }],     // → board.labels._id
  dueDate:      { type: Date, default: null },
  completed:    { type: Boolean, default: false },
  archived:     { type: Boolean, default: false },
  commentCount: { type: Number, default: 0 },          // denormalized for the card face
  createdBy:    { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });
```

Indexes:
- `{ listId: 1, archived: 1, position: 1, _id: 1 }` to render a column and find neighbors
- `{ boardId: 1, archived: 1 }` to load a board and list archived items

`boardId` is denormalized, so authorization needs no join. **Moving a card to another board is not supported**, so `boardId` never changes.

There's no text index. Search and filtering run **on the client** over the already-loaded board (at most 5,000 cards, see [05](05-FRONTEND.md#filters-and-search)). A text index only becomes necessary for search across boards, which is a stretch goal.

## Comment

```js
const commentSchema = new Schema({
  cardId:   { type: Schema.Types.ObjectId, ref: 'Card',  required: true },
  boardId:  { type: Schema.Types.ObjectId, ref: 'Board', required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User',  required: true },
  body:     { type: String, required: true, maxlength: 5000 },
}, { timestamps: true });
```
Index: `{ cardId: 1, _id: -1 }` for newest-first cursor pagination.

Creating or deleting a comment also does `$inc card.commentCount` (±1) in the same transaction.

## Versioning: Compare-and-Set

> ⚠️ Mongoose's `optimisticConcurrency: true` is **not enough**. It only detects changes between *this request's* read and its `save()`, a window of a few milliseconds. It can't tell that the *user* was editing an older copy for 30 seconds. The client's `version` has to be part of the update filter.

```js
// inside mutateBoard(card.boardId, async (session) => { ... })
const updated = await Card.findOneAndUpdate(
  { _id: cardId, version: baseVersion },
  { $set: changedFields, $inc: { version: 1 } },          // changedFields ⊆ {title, description}
  { new: true, runValidators: true, session },
);
if (!updated) {
  const current = await Card.findById(cardId).session(session).lean();
  throw current ? new ApiError(409, 'CONFLICT', { current }) : new ApiError(404, 'NOT_FOUND');
}
return { card: updated };
```

Field policy:

| Field(s) | Strategy | Why |
|----------|----------|-----|
| `title`, `description` | Compare-and-set on `version` | Free text: overwriting someone's paragraph is real data loss |
| `completed`, `dueDate`, `archived` | Last-write-wins `$set` | A single value: the latest intent wins |
| `assigneeIds`, `labelIds` | `$addToSet` / `$pull` | Commutative, so concurrent changes never conflict |
| `listId` + `position` | Last-write-wins via move | The latest drop wins, and every client converges |

Only text edits bump `version`, so a teammate toggling `completed` or adding a label never causes a false conflict on your description edit. A title change and a description change share one version, but the client merges those automatically when they don't overlap ([05](05-FRONTEND.md#card-modal-autosave-and-conflicts)).

## Cascades (all within `mutateBoard`, one event each)

| Action | Writes | Event |
|--------|--------|-------|
| Archive list | `list.archived = true` (its cards are left untouched and hidden along with the list) | `list:updated` |
| Delete list | Delete its cards and their comments | `list:deleted { listId }` |
| Delete card | Delete its comments | `card:deleted` |
| Delete board | Delete its lists, cards, comments, and the board | `board:deleted` (not revisioned) |
| Remove member | `$pull` from `members`; `$pull` the user ID from `assigneeIds` on that board's cards | `member:removed { userId }` (clients remove the ID from all cards locally) |
| Delete label | `$pull` from `board.labels`; `$pull` the label ID from `labelIds` on that board's cards | `label:deleted { labelId }` (clients remove it locally) |

Deleting a large board can exceed reasonable transaction size. For a board with more than about 1,000 cards, delete the `Board` document first, inside the transaction, so it vanishes for everyone at once. Then delete its children in batches after the commit. Orphaned children are invisible, because every query is scoped by board.

**Orphan sweep (ADR-019):** if the process crashes during the batched delete, children are left behind. On server startup (after the DB connects, without blocking `listen`), run a sweep: find distinct `boardId`s in `lists`, `cards`, and `comments` that have no `Board` document, and delete their children in batches. It's idempotent, so running it on every boot is safe.

## Board Load Query

```js
// 1. Board FIRST: this pins the revision
const board = await Board.findById(id).populate('members.userId', 'name email avatarColor').lean();
// 2. Then the children
const [lists, cards] = await Promise.all([
  List.find({ boardId: id, archived: false }).sort({ position: 1, _id: 1 }).lean(),
  Card.find({ boardId: id, archived: false }).sort({ position: 1, _id: 1 }).lean(),
]);
return { board, lists, cards, revision: board.revision };
```

Mutations are atomic transactions, so once the board shows revision R, every change ≤ R is already committed. The children read afterwards contain **at least** those changes, and possibly newer ones. Clients then re-apply events > R, which is harmless because events carry the full entity state. **Applying an event twice is safe, but skipping one is not.** Reading the board *last* could skip a change, so don't.

Cards in archived lists are filtered out on the client (the list isn't loaded). That's cheaper than a `$lookup`.
