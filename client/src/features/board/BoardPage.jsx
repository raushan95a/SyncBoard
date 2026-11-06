import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { canEdit, canManageBoard } from '@syncboard/shared/roles';
import { LIMITS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { AppHeader } from '../../components/AppHeader.jsx';
import { EditableText, InlineAdd } from '../../components/ui/InlineForm.jsx';
import { useBoard } from './useBoard.js';
import { cardsByList } from './cardUtils.js';
import { ListColumn } from './ListColumn.jsx';

/** /b/:boardId — keyed by boardId so switching boards starts fresh. */
export function BoardRoute() {
  const { boardId } = useParams();
  return <BoardPage key={boardId} boardId={boardId} />;
}

function BoardPage({ boardId }) {
  const navigate = useNavigate();
  const board = useBoard(boardId);
  const { status, data, run } = board;

  if (status === 'loading') {
    return (
      <div className="page"><AppHeader />
        <div className="board__lists">{[0, 1, 2].map((i) => <div key={i} className="list skeleton list--skeleton" />)}</div>
      </div>
    );
  }
  if (status === 'gone' || status === 'error') {
    return (
      <div className="page"><AppHeader />
        <main className="page__body empty">
          <h1>{status === 'gone' ? 'Board not found' : 'Could not load this board'}</h1>
          <p className="muted">{status === 'gone' ? 'It may have been deleted, or you no longer have access.' : board.error?.message}</p>
          <Link className="btn" to="/boards">Back to your boards</Link>
        </main>
      </div>
    );
  }

  const { board: meta, lists, cards, myRole } = data;
  const editable = canEdit(myRole);
  const isOwner = canManageBoard(myRole);
  const byList = cardsByList(cards);

  const rename = (title) => run(() => http.patch(`/boards/${boardId}`, { title }), 'Could not rename the board');
  const deleteBoard = async () => {
    const typed = window.prompt(`Delete "${meta.title}" and everything in it? Type the board name to confirm.`);
    if (typed === null) return;
    if (typed.trim() !== meta.title) return window.alert('The name did not match. Nothing was deleted.');
    try {
      await http.del(`/boards/${boardId}`);
      navigate('/boards');
    } catch {
      run(() => Promise.reject(new Error('Could not delete the board')));
    }
  };
  const addList = async (title) => (await run(() => http.post(`/boards/${boardId}/lists`, { title }), 'Could not add the list')).ok;

  return (
    <div className="page page--board">
      <AppHeader>
        <span className="topbar__sep" aria-hidden="true">/</span>
        <EditableText as="h1" className="board__title" value={meta.title} editable={isOwner} maxLength={LIMITS.BOARD_TITLE} label="board title" onSave={rename} />
        {myRole === 'viewer' && <span className="badge">View only</span>}
        {isOwner && <button className="btn btn--ghost btn--danger" onClick={deleteBoard}>Delete board</button>}
      </AppHeader>

      <main className="board__lists">
        {lists.length === 0 && !editable && <p className="muted">This board has no lists yet.</p>}
        {lists.map((list) => (
          <ListColumn key={list._id} list={list} cards={byList[list._id] ?? []} board={meta} editable={editable} run={run} />
        ))}
        {editable && (
          <div className="list list--add">
            {lists.length === 0 && <p className="muted">Add your first list</p>}
            <InlineAdd label="Add a list" placeholder="List title" maxLength={LIMITS.LIST_TITLE} onSubmit={addList} />
          </div>
        )}
      </main>

      {/* /b/:boardId/c/:cardId renders the card modal over the board */}
      <Outlet context={{ board, editable, boardId }} />
    </div>
  );
}
