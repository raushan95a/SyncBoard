# 05 — Frontend

## Structure

```
client/src/
├── main.jsx
├── app/
│   ├── store.js
│   └── router.jsx
├── api/
│   ├── http.js              # fetch wrapper: JSON, credentials, ApiError, 401 → logout
│   └── socket.js            # singleton (autoConnect: false); connect after login, disconnect on logout
├── features/
│   ├── auth/                # authSlice, LoginPage, RegisterPage, ProtectedRoute, bootstrap (/auth/me)
│   ├── boards/              # boardsSlice, BoardsPage, CreateBoardDialog (template picker)
│   └── board/
│       ├── boardSlice.js    # confirmed bases + displayed state + pending ops
│       ├── ops.js           # applyOp(entity, op) — pure; used for optimistic apply AND rebase
│       ├── remote.js        # applyEvent(state, evt) — pure; one case per event type
│       ├── thunks.js        # moveCard, createCard, saveContent, ... (per-entity serial sender)
│       ├── selectors.js     # memoized, including filters
│       ├── eventPipeline.js # pause/buffer, revision check, reorder, resync (docs/04)
│       ├── useBoardSocket.js
│       └── components/
│           ├── BoardView.jsx        # DragDropContext, header, filters
│           ├── ListColumn.jsx       # React.memo
│           ├── CardItem.jsx         # React.memo
│           ├── CardModal/           # title, description, fields, comments, conflict banner
│           ├── ArchivePanel.jsx
│           ├── MembersDialog.jsx
│           ├── LabelsEditor.jsx
│           ├── FilterBar.jsx
│           ├── PresenceBar.jsx
│           └── ConnectionBanner.jsx
├── components/ui/           # Button, Modal, Toast, Skeleton, Avatar, ConfirmDialog
└── vite.config.js           # proxy /api and /socket.io → :4000 (ws: true)
```

## State Model

```js
board: {
  meta: { id, title, revision, members: [], labels: [], myRole },
  lists: { byId: {}, order: [] },          // DISPLAYED (confirmed + pending ops)
  cards: { byId: {} },                     // DISPLAYED
  cardIdsByList: { [listId]: [cardId] },   // derived cache, sorted by comparePos
  bases: { [entityId]: entity | null | 'DELETED' },  // last CONFIRMED state, only while ops are pending
  ops: [ { mid, entityId, kind, op, status: 'queued'|'inflight'|'acked', revision? } ],
  filters: { text: '', memberIds: [], labelIds: [], due: null },
  status: 'loading' | 'ready' | 'error' | 'gone',
  connection: 'online' | 'reconnecting',
}
```

Why normalize? A move touches one card object and two ID arrays. Everything else keeps the same object reference, so `React.memo` skips it.

## Pending Operations (optimistic UI done right)

A single snapshot per mutation breaks in common situations:
- The user toggles "done" and then moves the same card. Confirming the first change makes the card jump back.
- A teammate edits the card while your move is still in flight.

So use the **rebase model** (the approach Linear and Replicache use):

> **displayed = replay(pending ops, on top of the last confirmed state)**

`ops.js` exports one pure function, used both for the optimistic apply and for the replay:

```js
export function applyOp(entity, op) {
  if (entity === 'DELETED') return 'DELETED';
  switch (op.type) {
    case 'create':   return op.entity;
    case 'move':     return { ...entity, listId: op.toListId, position: op.position };
    case 'content':  return { ...entity, ...op.fields };                 // title/description
    case 'fields':   return { ...entity, ...op.set };                    // completed/dueDate/archived
    case 'addTo':    return { ...entity, [op.key]: [...new Set([...entity[op.key], op.id])] };
    case 'pullFrom': return { ...entity, [op.key]: entity[op.key].filter((x) => x !== op.id) };
    case 'delete':   return 'DELETED';
  }
}
```

Lifecycle, all inside `boardSlice` reducers:

| Moment | What happens |
|--------|--------------|
| **User action** | If `bases[id]` is unset, set it to the current displayed entity (`null` for a create). Push the op. Displayed = `applyOp(displayed, op)`. |
| **REST success** | `op.status = 'acked'`, `op.revision = res.revision`. Keep the op. The confirmed state changes only when the echo arrives. |
| **REST error** | Remove the op. Displayed = replay of the remaining ops on top of the base. Toast. Changes from teammates are preserved, because the base already contains them. |
| **Remote event for an entity with a base** | Base = the event's entity. Displayed = replay of the pending ops on top of the new base. The user's in-flight move stays visible, and the teammate's other field changes appear. |
| **Own echo** (`clientMutationId` matches) | Base = the event's entity. Remove that op, then replay the rest. If no ops remain → delete `bases[id]`. |
| **Remote event, no base** | Apply directly to the displayed state. |
| **Indirect remote change** (`rebalanced` positions, `member:removed`, `label:deleted`, `comment:*` count) to an entity **with** a base | Apply the change to the base, then replay the pending ops. Never patch only the displayed entity (ADR-016). |
| **Resync snapshot (revision R)** | Replace everything. Drop acked ops whose `revision ≤ R`. For the remaining ops: base = the snapshot entity, then replay. |

Test for the indirect-change rule (in `remote.test.js`): a card has a pending `fields { completed }` op and carries label L; `label:deleted { labelId: L }` arrives; then the op is echoed or fails. In both cases the displayed card must not contain L. The same goes for `member:removed` with an assignee, and for `rebalanced` with a pending `fields` op: the base's position must be the rebalanced one.

Side effects, such as a toast, re-sorting `cardIdsByList` for the affected lists, or closing the modal when the displayed entity becomes `'DELETED'`, are computed from the change in displayed state, never from the op type.

**One request in flight per entity.** `thunks.js` chains requests for each `entityId`, sending the next only after the previous one settles. This keeps the server's order the same as the user's order (HTTP doesn't guarantee request order), and lets content saves use the version returned by the previous save.

### Move thunk

```js
export const moveCard = ({ cardId, toListId, beforeId, afterId }) => (dispatch, getState) => {
  const { cards } = getState().board;
  const mid = nanoid();
  const position = between(cards.byId[beforeId]?.position, cards.byId[afterId]?.position);
  dispatch(opStarted({ mid, entityId: cardId, op: { type: 'move', toListId, position } }));
  return sendSerial(cardId, () =>
    http.patch(`/cards/${cardId}/move`, { toListId, beforeId, afterId, clientMutationId: mid }))
    .then((res) => dispatch(opAcked({ mid, revision: res.revision })))
    .catch((err) => {
      dispatch(opFailed({ mid }));
      toast.error(err.code === 'NOT_FOUND' ? 'That list or card no longer exists' : 'Could not move card');
    });
};
```

### Create (optimistic, with client-generated IDs)

```js
const _id = new ObjectId().toHexString();                // bson-objectid
const last = lastCardIn(listId);
dispatch(opStarted({ mid, entityId: _id, op: { type: 'create', entity: {
  _id, listId, boardId, title, position: between(last?.position, null),
  version: 0, assigneeIds: [], labelIds: [], commentCount: 0, completed: false, dueDate: null,
}}}));
sendSerial(_id, () => http.post(`/lists/${listId}/cards`, { _id, title, clientMutationId: mid }));
```

The new card can be dragged or opened immediately. Any follow-up requests are chained behind the create.

## Drag and Drop (`@hello-pangea/dnd`)

```jsx
function onDragStart({ type }) { pipeline.pause('drag'); }

function onDragEnd({ source, destination, draggableId, type }) {
  try {
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    if (type === 'LIST') {
      const ids = visibleListIds.filter((id) => id !== draggableId);
      return dispatch(moveList({ listId: draggableId, beforeId: ids[destination.index - 1] ?? null,
                                 afterId: ids[destination.index] ?? null }));
    }
    // IMPORTANT: use the RENDERED (filtered) ids, because destination.index refers to what the user saw
    const ids = selectVisibleCardIds(state, destination.droppableId).filter((id) => id !== draggableId);
    dispatch(moveCard({ cardId: draggableId, toListId: destination.droppableId,
                        beforeId: ids[destination.index - 1] ?? null, afterId: ids[destination.index] ?? null }));
  } finally {
    pipeline.resume('drag');              // after the optimistic apply, so remote events rebase onto it
  }
}
```

- `type="LIST"` (horizontal) for columns, `type="CARD"` for cards.
- Dragging is disabled when `connection !== 'online'` or `myRole === 'viewer'`.
- Filtered view: hidden cards between two visible neighbors are fine. The new position falls between the visible neighbors, which is exactly what the user sees.

## Socket Hook

```js
export function useBoardSocket(boardId) {
  const dispatch = useDispatch();
  useEffect(() => {
    const s = getSocket();
    const pipeline = createEventPipeline({ dispatch, getState: store.getState, boardId });

    const onConnect = async () => {
      dispatch(setConnection('online'));
      pipeline.pause('load');
      const res = await s.emitWithAck(EVT.BOARD_JOIN, { boardId });
      if (res.error) return dispatch(boardGone('not-found'));
      const snap = await dispatch(fetchBoard(boardId)).unwrap();
      pipeline.resetTo(snap.revision);                     // drop buffered ≤ R, apply the rest, rebase ops
      pipeline.resume('load');
    };
    const onDisconnect = () => dispatch(setConnection('reconnecting'));

    const handlers = Object.fromEntries(REVISIONED_EVENTS.map((e) => [e, (p) => pipeline.push(e, p)]));
    handlers[EVT.PRESENCE_UPDATE] = (p) => dispatch(presenceUpdated(p));
    handlers[EVT.CARD_EDITING]    = (p) => dispatch(editingUpdated(p));
    handlers[EVT.BOARD_DELETED]   = (p) => dispatch(boardGone('deleted', p.actorName));
    handlers[EVT.ACCESS_REVOKED]  = (p) => p.boardId === boardId && dispatch(boardGone('removed'));

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    Object.entries(handlers).forEach(([e, h]) => s.on(e, h));
    if (s.connected) onConnect();

    return () => {
      s.emit(EVT.BOARD_LEAVE, { boardId });
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      Object.entries(handlers).forEach(([e, h]) => s.off(e, h));   // never removeAllListeners()
      pipeline.dispose();
      dispatch(boardCleared());
    };
  }, [boardId, dispatch]);
}
```

These listeners are **global**: they're registered once in `socket.js` and live for the whole session.
- `connect_error` with `UNAUTHENTICATED` → `logout()` → `/login`
- `session:revoked` → `logout()`
- `boards:changed` → invalidate `boardsSlice` (refetch if the boards page is mounted)

`boardGone(reason)` sets `status: 'gone'` and shows a full-page message ("This board was deleted by X" / "You no longer have access"), with a button back to `/boards`.

## Card Modal: Autosave and Conflicts

The modal keeps a **draft** in local state:

```js
draft     = { title, description }                 // what's in the inputs
draftBase = { title, description, version }        // the server values the user started editing from
dirty     = fields where draft !== draftBase
```

**Saving** (800 ms debounce; one request in flight; follow-up changes are combined):
- Send `PATCH /cards/:id/content { ...dirtyFields, version: draftBase.version }`. It also goes through the ops system as a `content` op, so the card face updates optimistically.
- On success: `draftBase.version = res.card.version`, and `draftBase[f] = res.card[f]` for each field sent.

**A remote `card:updated` arrives:**
- Field not dirty → update both the draft and `draftBase` for that field, plus `draftBase.version`.
- Field dirty → **leave the draft and `draftBase` alone.** Show the pill "Alice changed the description". (Updating `draftBase.version` here would make the next save overwrite Alice's change without a conflict.)

**On `409`** with `current`, run a three-way check for each dirty field `f`:
- `current[f] === draftBase[f]`: nobody else touched this field. Safe.
- Otherwise: a real conflict.

If every dirty field is safe, the other person changed a *different* field. **Retry automatically** with `version: current.version` and update the non-dirty fields from `current`. There's no banner. This covers the common case of one person editing the title while another edits the description.

If a field truly conflicts, show the banner "Alice changed the description while you were editing" with three options:
- **[Use theirs]**: draft = `current`
- **[Keep mine]**: retry with `current.version`
- **[Copy mine]**: copy my text to the clipboard, then use theirs

Other parts of the modal:
- **Simple fields** (done, due date, labels, assignees) save instantly as ops. They never conflict.
- **Editing indicator:** `card:editing:start` on focus, a heartbeat every 10 s, `stop` on blur or close. Show "Alice is editing…" next to the field.
- **Deleted while open:** if the displayed card becomes `'DELETED'`, close the modal and toast "Card was deleted by X".
- **Archived card:** the modal shows an "Archived" banner with **Restore** and **Delete permanently** buttons.
- **Comments:** fetched with the card (first page), "Load more" uses the cursor. `comment:created` for the open card is prepended. On reconnect, the modal refetches the first page.

## Filters and Search

All cards are loaded, so filtering is a **memoized selector**. There's no server round trip.

```js
selectVisibleCardIds(state, listId) =
  cardIdsByList[listId].filter((id) => matches(cards.byId[id], filters))
// text: case-insensitive match on title (and description)
// members: any assigneeId in the selected set; labels: any labelId in the set
// due: 'overdue' | 'week' | 'none'
```

Keep the filter state in the URL query string, so a filtered view can be shared. Show "N cards hidden by filters" in each column.

## Performance Checklist

- [x] `CardItem = React.memo(...)` receives only `cardId` and `index`, and selects its own card.
- [x] `ListColumn` selects `selectVisibleCardIds(listId)` (memoized per list), so it doesn't re-render because of other lists.
- [x] No component selects the whole `board` slice.
- [x] Reducers keep the **same array reference** for `cardIdsByList[x]` when list x didn't change. A rebase replays only the affected entity.
- [x] No inline object or array props to memoized children.
- [x] Render-count test: moving one card re-renders exactly three components.
- [ ] Virtualize only if a list has more than 200 cards (measure first).

## Routing

```
/login  /register
/boards                     (protected)
/b/:boardId                 (protected; ?q=&members=&labels= filters)
/b/:boardId/c/:cardId       (modal over the board; deep link works after the board loads)
```

## HTTP Wrapper Rules

- `credentials: 'same-origin'`, `Content-Type: application/json`.
- 401 on any request except `/auth/*` → dispatch `logout()` and go to `/login?next=<current>`.
- Normalize errors into `ApiError { status, code, message, details }`.
- A 30 s timeout. A timed-out mutation is treated as failed, but its echo may still arrive, and the rebase model then shows the correct state.

## UX Details

- Skeleton while loading. An empty board shows "Add your first list".
- A confirm dialog for deletes ("Delete list and its 12 cards?"). Archive needs no confirmation.
- Toasts for errors.
- Keyboard drag-and-drop (built into the library), with `aria-label`s on cards and lists.
- Presence avatars, editing badges, and a "Reconnecting…" banner with dragging disabled.
- Viewer role: no edit controls, and a "View only" badge. The server enforces this anyway.
- Due date chip: gray, amber within 24 h, red when overdue, green when completed.
