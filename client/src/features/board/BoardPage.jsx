import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import toast from 'react-hot-toast';
import { canEdit, canManageBoard } from '@syncboard/shared/roles';
import { LIMITS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { AppHeader } from '../../components/AppHeader.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { EditableText, InlineAdd } from '../../components/ui/InlineForm.jsx';
import { renameBoard, createList, moveList, moveCard, messageFor } from './thunks.js';
import {
  selectBoardStatus, selectBoardError, selectGone, selectConnection, selectMeta, selectMyRole, selectListOrder,
  selectPresence, makeSelectVisibleCardIds,
} from './selectors.js';
import { filtersChanged } from './boardSlice.js';
import { parseFilters, writeFilters } from './filters.js';
import { FilterBar } from './FilterBar.jsx';
import { countRender } from './perf.js';
import { useBoardSocket } from './useBoardSocket.js';
import { ListColumn } from './ListColumn.jsx';
import { MembersDialog, LabelsEditor, ArchivePanel } from './BoardDialogs.jsx';

const GONE_TEXT = {
  'not-found': ['Board not found', 'It may have been deleted, or you no longer have access.'],
  deleted: ['This board was deleted', null],
  removed: ['You no longer have access', 'You were removed from this board.'],
};

/** /b/:boardId — keyed by boardId so switching boards starts fresh. */
export function BoardRoute() {
  const { boardId } = useParams();
  return <BoardPage key={boardId} boardId={boardId} />;
}

function BoardPage({ boardId }) {
  const status = useSelector(selectBoardStatus);
  const error = useSelector(selectBoardError);
  const gone = useSelector(selectGone);
  const { pauseDrag, resumeDrag } = useBoardSocket(boardId);

  if (status === 'gone' || status === 'error') {
    const [title, text] = status === 'gone'
      ? GONE_TEXT[gone.reason] ?? GONE_TEXT['not-found']
      : ['Could not load this board', error?.message];
    return (
      <div className="page"><AppHeader />
        <main className="page__body empty">
          <h1>{title}</h1>
          <p className="muted">{gone.reason === 'deleted' ? `${gone.by ?? 'Someone'} deleted it.` : text}</p>
          <Link className="btn" to="/boards">Back to your boards</Link>
        </main>
      </div>
    );
  }
  if (status !== 'ready') {
    return (
      <div className="page"><AppHeader />
        <div className="board__lists">{[0, 1, 2].map((i) => <div key={i} className="list skeleton list--skeleton" />)}</div>
      </div>
    );
  }
  return <BoardView boardId={boardId} pauseDrag={pauseDrag} resumeDrag={resumeDrag} />;
}

/** "Reconnecting…" while the socket is down. Edits still work over REST; dragging doesn't. */
function ConnectionBanner() {
  const connection = useSelector(selectConnection);
  if (connection === 'online') return null;
  return <div className="banner banner--warn banner--conn" role="status">Reconnecting… changes from others will appear when the connection is back.</div>;
}

/** Who's viewing this board right now: one avatar per user, however many tabs (F14). */
function PresenceBar() {
  const users = useSelector(selectPresence);
  if (!users.length) return null;
  return (
    <ul className="presence" aria-label={`${users.length} viewing`}>
      {users.slice(0, 8).map((u) => <li key={u.id} title={u.name}><Avatar user={u} size={26} /></li>)}
      {users.length > 8 && <li className="presence__more">+{users.length - 8}</li>}
    </ul>
  );
}

function BoardView({ boardId, pauseDrag, resumeDrag }) {
  countRender('BoardView');
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const meta = useSelector(selectMeta);
  const myRole = useSelector(selectMyRole);
  const listOrder = useSelector(selectListOrder);
  const online = useSelector(selectConnection) === 'online';
  const editable = canEdit(myRole);
  const canDrag = editable && online;
  const [dialog, setDialog] = useState(null);       // 'members' | 'labels' | 'archive'

  // The URL is the source of truth for filters; mirror it into the store for the selectors.
  const [params] = useSearchParams();
  useEffect(() => {
    const filters = parseFilters(params);
    const qs = writeFilters(new URLSearchParams(), filters).toString();
    dispatch(filtersChanged({ filters, query: qs ? `?${qs}` : '' }));
  }, [params, dispatch]);
  const closeDialog = useCallback(() => setDialog(null), []);
  const isOwner = canManageBoard(myRole);

  const deleteBoard = async () => {
    const typed = window.prompt(`Delete "${meta.title}" and everything in it? Type the board name to confirm.`);
    if (typed === null) return;
    if (typed.trim() !== meta.title) return window.alert('The name did not match. Nothing was deleted.');
    try {
      await http.del(`/boards/${boardId}`);
      navigate('/boards');
    } catch (err) {
      if (err.status !== 401) toast.error(messageFor(err, 'Could not delete the board'));
    }
  };

  /**
   * Neighbors come from what the user SAW: the rendered (filtered) ids with the dragged item
   * removed (docs/05 — Drag and Drop). With a filter active, hidden cards may sit between the
   * visible neighbors; the server places the card directly after `before` (ADR-014).
   * Dropping back in place is a no-op and never reaches the server.
   */
  const drop = useCallback(({ source, destination, draggableId, type }) => {
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;
    const state = store.getState();
    const neighbors = (ids) => {
      const rest = ids.filter((id) => id !== draggableId);
      return { beforeId: rest[destination.index - 1] ?? null, afterId: rest[destination.index] ?? null };
    };
    if (type === 'LIST') {
      dispatch(moveList({ listId: draggableId, ...neighbors(selectListOrder(state)) }));
    } else {
      const toListId = destination.droppableId;
      dispatch(moveCard({ cardId: draggableId, toListId, ...neighbors(makeSelectVisibleCardIds()(state, toListId)) }));
    }
  }, [dispatch, store]);

  // Events are buffered while dragging: lists must not change under the pointer (docs/04).
  const onDragEnd = useCallback((result) => {
    try {
      drop(result);
    } finally {
      resumeDrag();                       // AFTER the optimistic apply, so buffered events rebase onto it
    }
  }, [resumeDrag, drop]);

  return (
    <div className="page page--board">
      <AppHeader>
        <span className="topbar__sep" aria-hidden="true">/</span>
        <EditableText as="h1" className="board__title" value={meta.title} editable={isOwner} maxLength={LIMITS.BOARD_TITLE}
          label="board title" onSave={(title) => dispatch(renameBoard(title))} />
        {myRole === 'viewer' && <span className="badge">View only</span>}
        <PresenceBar />
        <nav className="board-menu" aria-label="Board menu">
          <button className="btn btn--ghost" onClick={() => setDialog('members')}>Members</button>
          {editable && <button className="btn btn--ghost" onClick={() => setDialog('labels')}>Labels</button>}
          <button className="btn btn--ghost" onClick={() => setDialog('archive')}>Archive</button>
          {isOwner && <button className="btn btn--ghost btn--danger" onClick={deleteBoard}>Delete board</button>}
        </nav>
      </AppHeader>
      <ConnectionBanner />
      <FilterBar />

      <DragDropContext onDragStart={pauseDrag} onDragEnd={onDragEnd}>
        <Droppable droppableId="board" type="LIST" direction="horizontal">
          {(provided) => (
            <main className="board__lists" ref={provided.innerRef} {...provided.droppableProps}>
              {listOrder.length === 0 && !editable && <p className="muted">This board has no lists yet.</p>}
              {listOrder.map((listId, index) => (
                <ListColumn key={listId} listId={listId} index={index} editable={editable} canDrag={canDrag} />
              ))}
              {provided.placeholder}
              {editable && (
                <div className="list list--add">
                  {listOrder.length === 0 && <p className="muted">Add your first list</p>}
                  <InlineAdd label="Add a list" placeholder="List title" maxLength={LIMITS.LIST_TITLE}
                    onSubmit={(title) => { dispatch(createList(title)); return true; }} />
                </div>
              )}
            </main>
          )}
        </Droppable>
      </DragDropContext>

      {dialog === 'members' && <MembersDialog isOwner={isOwner} onClose={closeDialog} />}
      {dialog === 'labels' && editable && <LabelsEditor onClose={closeDialog} />}
      {dialog === 'archive' && <ArchivePanel editable={editable} onClose={closeDialog} />}

      {/* /b/:boardId/c/:cardId renders the card modal over the board */}
      <Outlet context={{ editable, boardId }} />
    </div>
  );
}
