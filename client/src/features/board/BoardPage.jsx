import { useCallback, useEffect } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import toast from 'react-hot-toast';
import { canEdit, canManageBoard } from '@syncboard/shared/roles';
import { LIMITS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { AppHeader } from '../../components/AppHeader.jsx';
import { EditableText, InlineAdd } from '../../components/ui/InlineForm.jsx';
import { boardLeft } from './boardSlice.js';
import { loadBoard, renameBoard, createList, moveList, moveCard, messageFor } from './thunks.js';
import { selectBoardStatus, selectBoardError, selectMeta, selectMyRole, selectListOrder, selectCardIds } from './selectors.js';
import { ListColumn } from './ListColumn.jsx';

/** /b/:boardId — keyed by boardId so switching boards starts fresh. */
export function BoardRoute() {
  const { boardId } = useParams();
  return <BoardPage key={boardId} boardId={boardId} />;
}

function BoardPage({ boardId }) {
  const dispatch = useDispatch();
  const status = useSelector(selectBoardStatus);
  const error = useSelector(selectBoardError);

  useEffect(() => {
    dispatch(loadBoard(boardId));
    return () => { dispatch(boardLeft()); };
  }, [boardId, dispatch]);

  if (status === 'gone' || status === 'error') {
    return (
      <div className="page"><AppHeader />
        <main className="page__body empty">
          <h1>{status === 'gone' ? 'Board not found' : 'Could not load this board'}</h1>
          <p className="muted">{status === 'gone' ? 'It may have been deleted, or you no longer have access.' : error?.message}</p>
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
  return <BoardView boardId={boardId} />;
}

function BoardView({ boardId }) {
  const dispatch = useDispatch();
  const store = useStore();
  const navigate = useNavigate();
  const meta = useSelector(selectMeta);
  const myRole = useSelector(selectMyRole);
  const listOrder = useSelector(selectListOrder);
  const editable = canEdit(myRole);
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
   * Neighbors come from what the user SAW: the rendered ids with the dragged item removed
   * (docs/05 — Drag and Drop). Dropping back in place is a no-op and never reaches the server.
   */
  const onDragEnd = useCallback(({ source, destination, draggableId, type }) => {
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
      dispatch(moveCard({ cardId: draggableId, toListId, ...neighbors(selectCardIds(state, toListId)) }));
    }
  }, [dispatch, store]);

  return (
    <div className="page page--board">
      <AppHeader>
        <span className="topbar__sep" aria-hidden="true">/</span>
        <EditableText as="h1" className="board__title" value={meta.title} editable={isOwner} maxLength={LIMITS.BOARD_TITLE}
          label="board title" onSave={(title) => dispatch(renameBoard(title))} />
        {myRole === 'viewer' && <span className="badge">View only</span>}
        {isOwner && <button className="btn btn--ghost btn--danger" onClick={deleteBoard}>Delete board</button>}
      </AppHeader>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="board" type="LIST" direction="horizontal">
          {(provided) => (
            <main className="board__lists" ref={provided.innerRef} {...provided.droppableProps}>
              {listOrder.length === 0 && !editable && <p className="muted">This board has no lists yet.</p>}
              {listOrder.map((listId, index) => (
                <ListColumn key={listId} listId={listId} index={index} editable={editable} />
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

      {/* /b/:boardId/c/:cardId renders the card modal over the board */}
      <Outlet context={{ editable, boardId }} />
    </div>
  );
}
