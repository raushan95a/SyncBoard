# 11 — Feature Workflows & Edge Cases

Every feature traced end to end: **UI → client → API → server (transaction) → event → other clients → edge cases.** Use this file as the checklist when you implement and test each feature.

Notation: **A** = the user acting, **B** = another member on the same board, **op** = a pending optimistic operation ([05](05-FRONTEND.md#pending-operations-optimistic-ui-done-right)).

---

## F1. Register / Login / Session

| Step | Detail |
|------|--------|
| UI | Login and register forms validated with the shared Zod schemas, so error messages appear before submit |
| API | `POST /auth/register` or `/auth/login` → cookie set → `{ user }` |
| Client | `authSlice.user = user` → `socket.connect()` → redirect to `?next` or `/boards` |
| App boot | `GET /auth/me`, with a full-screen spinner until it resolves. 401 → public routes only. |

Edge cases:
- **Duplicate email** → 400 `EMAIL_TAKEN`, shown on the field.
- **Wrong password or unknown email** → the same generic 401, with similar timing (bcrypt runs either way).
- **Token expires mid-session** → the next REST call returns 401, which triggers `logout()` and `/login?next=…`. Unsaved modal drafts are lost, so save drafts to `sessionStorage` on every keystroke.
- **Logout** → `POST /auth/logout` → `socket.disconnect()` → reset the store → `/login`.
- **Logout everywhere** → `tokenVersion++` → `session:revoked` reaches the user's other tabs and devices, and their sockets are disconnected.
- **Several tabs** → each has its own socket, and all of them join `user:<id>`. Logging out in one tab: other tabs find out on their next REST call (401) or through `session:revoked` (logout everywhere).

## F2. Boards Page

| Step | Detail |
|------|--------|
| Load | `GET /boards` → cards showing title, role, last updated |
| Create | Dialog: title + template (Basic: To Do/Doing/Done, or Empty) → `POST /boards` → navigate to `/b/:id` |
| Live | `boards:changed` in the user room → refetch the list |

Edge cases:
- **A is added to a board while on this page** → `boards:changed { reason: 'added' }` → the board appears.
- **A board is deleted or A is removed** → it disappears.
- **No boards yet** → empty state with a "Create your first board" button.

## F3. Open Board (load + join)

```
navigate /b/:id → status 'loading' (skeleton)
→ socket board:join (ack) → pipeline paused
→ GET /boards/:id → snapshot R
→ resetTo(R) → resume → status 'ready'
```

Edge cases:
- **Not a member, or the board doesn't exist** → the join ack and GET both say NOT_FOUND → status `'gone'` ("Board not found").
- **Changes during loading** → buffered; events ≤ R are dropped and later ones applied.
- **Deep link to `/b/:id/c/:cardId`** → the modal opens after the board is ready. If the card isn't in the board state, call `GET /cards/:id`: archived → open with the archived banner; 404 → toast "Card not found" and remove `/c/:cardId` from the URL.
- **Switching boards** → the hook cleanup sends `board:leave` and clears the slice. The server also leaves the previous room when the socket joins a new board.

## F4. Lists: Create, Rename, Move, Archive, Delete

| Action | Client op | API | Event | B sees |
|--------|-----------|-----|-------|--------|
| Create | `create` (client `_id`, appended to the end) | `POST /boards/:id/lists` | `list:created` | A new column |
| Rename | `fields { title }` (inline edit, saved on blur or Enter) | `PATCH /lists/:id` | `list:updated` | The new title |
| Move | `move` (drag the column header) | `PATCH /lists/:id/move` | `list:moved` | The column jumps to its new place |
| Archive | `fields { archived: true }` | `PATCH /lists/:id` | `list:updated` | The column and its cards disappear |
| Delete | `delete` (after a confirm dialog that shows the card count) | `DELETE /lists/:id` | `list:deleted` | The column and its cards disappear; an open modal for one of those cards closes |

Edge cases:
- **B drags a card into a list A just deleted** → B's move gets 404 → B's op is removed → but the `list:deleted` event already set B's base for that card to DELETED → the card disappears for B. Toast "That list no longer exists".
- **A and B rename the same list** → last write wins, and both converge through the events.
- **Restoring an archived list** (Archive panel) → `PATCH { archived: false }` → the server appends it to the end with a fresh position → `list:updated` → B's client must **load the list's cards**, because they weren't in its snapshot. Simplest approach: on `list:updated` with `archived: false` for a list the client doesn't have → `resync()`.
- **List limit (100)** → 422, rollback, toast.

## F5. Cards: Create

| Step | Detail |
|------|--------|
| UI | "+ Add a card" at the bottom of a column → textarea → Enter submits and keeps the form open for the next card. Escape closes it. |
| Client | Generates `_id` → `create` op → the card appears immediately and can be dragged or opened |
| API | `POST /lists/:listId/cards { _id, title, clientMutationId }` |
| Server | Transaction: check the list exists and the card limit → `position = between(last, null)` (rebalance if it's too long) → insert → `$inc revision` |
| Event | `card:created { card, rebalanced? }` |

Edge cases:
- **A and B append to the same list at the same moment** → the transactions are serialized, and each append reads the *current* last card, so the keys are distinct. The `_id` tie-break is only a safety net.
- **A edits or moves the new card before the create is confirmed** → those requests are chained per entity, so they're sent after the create succeeds.
- **The create fails** → the op is removed, and the base is `null` → the card disappears → toast. Later ops on that card fail with 404 and are removed too.
- **Retry after a timeout** → the same `_id` → the server returns the existing card (200), so it's idempotent.

## F6. Cards: Move (drag and drop)

Full flow in [01](01-ARCHITECTURE.md#card-move-lifecycle-the-interview-story). Edge cases:

| Scenario | Outcome |
|----------|---------|
| Dropped back in the same place | No op, no request |
| Dropped outside any list | No op |
| A filter is active | Neighbors are taken from the **visible** IDs, and the card lands between the visible neighbors |
| A neighbor was moved away by B during A's drag | The server ignores the stale neighbor and places the card using the other one |
| A and B drop different cards into the same gap | Serialized; the second is placed after `before`'s current successor, so the keys are distinct |
| B moves the **same** card at the same time | Both commit, and the later revision wins. A sees its own echo, then B's event, and both clients converge |
| B edits the card's description during A's move | B's `card:updated` becomes A's new base, and A's move op is replayed on top. A sees B's text with the card in A's new spot |
| A's request fails (500, 403, offline) | The op is removed, the card returns to its confirmed (base) position, and a toast appears |
| Events arrive during the drag | Buffered while the pipeline is paused, then applied after the drop |
| A loses connection mid-drag | Drop allowed; the request fails → rollback. Dragging is disabled once the banner shows. |
| Rebalance needed | Same transaction. The event carries `rebalanced` and is applied first. |
| A viewer tries to drag | Disabled in the UI; the server returns 403 anyway |

## F7. Card Content (title, description)

Full flow in [05](05-FRONTEND.md#card-modal-autosave-and-conflicts).

| Scenario | Outcome |
|----------|---------|
| A types, and nobody else is editing | Debounced saves, and the version is chained from each response |
| A edits the title, B edits the description at the same time | One save gets 409 → three-way check: different fields → automatic retry, **no banner** |
| A and B edit the description at the same time | The second save gets 409 → conflict banner (use theirs / keep mine / copy mine) |
| B's save lands while A's description field is dirty | A's draft is untouched; A sees the pill "B changed this". A's next save → 409 → banner |
| B's save lands while A's modal is open but A's field isn't dirty | A's field updates in place |
| A closes the modal with an unsaved draft | The pending debounce is flushed immediately |
| Description is Markdown | Rendered with `react-markdown` (no raw HTML). Preview and edit modes. |

## F8. Card Fields (done, due date, labels, assignees)

| Field | Op | API | Conflict behavior |
|-------|----|-----|-------------------|
| Done checkbox | `fields { completed }` | `PATCH /cards/:id` | Last write wins |
| Due date | `fields { dueDate }` (date picker, can be cleared) | `PATCH /cards/:id` | Last write wins |
| Label toggle | `addTo`/`pullFrom` `labelIds` | `POST`/`DELETE /cards/:id/labels` | Commutative, never conflicts |
| Assignee toggle | `addTo`/`pullFrom` `assigneeIds` | `POST`/`DELETE /cards/:id/assignees` | Commutative |

Edge cases:
- **Assigning a user B just removed from the board** → 400 → rollback, toast "Not a board member".
- **Adding a label B just deleted** → 400 → rollback.
- **Due dates:** store them as UTC, render in local time. The overdue check runs on the client (a 1-minute ticker, or check on render).

## F9. Archive and Restore

- **Archive** a card or list: the "Archive" action → `fields { archived: true }` → hidden for everyone.
- **Archive panel** (board menu): `GET /boards/:id/archived` → lists and cards, newest first, each with **Restore** and **Delete permanently**.
- **Restore a card** → appended to the end of its original list. If that list is archived → 422 "Restore the list first".
- The panel isn't live. It refetches each time it's opened.

## F10. Delete (card, list, board)

| Target | Who | Confirmation | Event | Effect on B |
|--------|-----|--------------|-------|-------------|
| Card | editor | Confirm dialog (from the modal or the archive panel) | `card:deleted` | Card disappears; an open modal closes with a toast |
| List | editor | "Delete list and its N cards?" | `list:deleted` | Column and cards disappear |
| Board | owner | Type the board name to confirm | `board:deleted` + `boards:changed` | Full-page "Board deleted by A" → back to `/boards` |

## F11. Comments

| Step | Detail |
|------|--------|
| Read | Opening the modal loads the first 20 comments; "Load more" uses the cursor |
| Create | Submit → pessimistic (spinner on the button; comments aren't in board state) → `{ comment, commentCount }` |
| Event | `comment:created` → every client updates `card.commentCount` (the card face badge), and clients with this card open prepend the comment |
| Delete | Author or owner → `comment:deleted` → removed and the count updated |

Edge cases:
- **Commenting on a card B just deleted** → 404 → toast, and the modal closes.
- **The modal is open during a reconnect** → refetch the first page.
- **Viewer** → no comment box.

## F12. Members and Roles

| Action | Who | API | Events |
|--------|-----|-----|--------|
| Invite | owner | `POST /boards/:id/members { email, role }` | `member:added`; invitee gets `boards:changed` |
| Change role | owner | `PATCH …/members/:userId` | `member:updated` |
| Remove / leave | owner, or self | `DELETE …/members/:userId` | `member:removed`; removed user gets `board:access-revoked` and `boards:changed` |

Edge cases:
- **Unregistered email** → 404 "No account with that email" (email invitations are out of scope).
- **Demoting or removing the last owner** → 422.
- **A is demoted to viewer while dragging** → A's move gets 403 → rollback → `member:updated` sets `myRole = viewer` → the UI becomes read-only.
- **A is removed while the card modal is open** → `board:access-revoked` → full-page "You no longer have access".
- **The removed user was assigned to cards** → the server removes their assignments in the same transaction, and every client removes the ID locally on `member:removed`.

## F13. Labels (board-level)

- **Labels editor** (board menu): create, rename, recolor, delete. Editors only.
- A new board gets 6 default colors with no names.
- **Delete** → the server removes the label from every card → `label:deleted` → clients remove it locally.
- **Rename or recolor** → `board:updated` → every card face re-renders the chip. Cards store only label IDs, so they don't change.

## F14. Presence and Editing Indicators

- Avatars in the header, one per user (a user with several tabs appears once).
- An "Alice is editing" badge on the card face and next to the field in the modal.
- Expires after 30 s without a heartbeat. Cleared on disconnect.
- Advisory only. Correctness never depends on it.

## F15. Filters and Search

- The filter bar offers text, members, labels, and due date (overdue / this week / none). It's stored in the URL query.
- Client-side memoized selector. Columns show "N hidden".
- Dragging works while filtered, using the visible neighbors (see F6).
- Live events that make a card match or stop matching update the view automatically, because the selector re-runs.

## F16. Connection Loss and Recovery

```
disconnect → banner "Reconnecting…" → drag disabled, edits still allowed (REST may still work)
→ socket.io auto-reconnect → onConnect → join → pause → GET board → resetTo(R) → rebase pending ops → resume → banner hidden
```

Edge cases:
- **The server restarts** → the same flow; no user action needed.
- **Reconnect is rejected (token expired)** → `connect_error UNAUTHENTICATED` → `/login`.
- **A was removed from the board while offline** → the join ack returns NOT_FOUND → status `'gone'`.
- **A is removed at the exact moment A joins** → the server re-checks membership after joining and removes the socket from the room → NOT_FOUND → status `'gone'`.
- **A's REST mutation succeeded while the socket was down** → the op is acked with revision r; the resync snapshot has R ≥ r, so the op is dropped. No duplicate.

---

## Concurrency Matrix

Rows: A's action. Columns: B's concurrent action.

| A ↓ / B → | Move same card | Edit same text | Toggle field | Delete card | Delete list | Remove A |
|-----------|----------------|----------------|--------------|-------------|-------------|----------|
| **Move card** | Later revision wins; both converge | Both apply (different fields) | Both apply | A: 404 → card gone | A: 404 → card gone | A: 404 → access revoked |
| **Edit text** | Both apply | 409 → merge or banner | Both apply (no version bump) | A: 404 → modal closes | A: 404 → modal closes | 404 → access revoked |
| **Toggle field** | Both apply | Both apply | Last write wins | 404 → gone | 404 → gone | 404 → revoked |
| **Comment** | Both apply | Both apply | Both apply | 404 → modal closes | 404 → modal closes | 404 → revoked |

"Both apply" relies on the rebase model: B's event becomes A's new base, and A's pending op is replayed on top of it. **Every cell ends with all clients matching the database.** Turn this matrix into integration and E2E tests ([08](08-TESTING-DEPLOYMENT.md)).
