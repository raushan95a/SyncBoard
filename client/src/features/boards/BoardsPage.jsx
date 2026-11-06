import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { LIMITS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { AppHeader } from '../../components/AppHeader.jsx';
import { Modal } from '../../components/ui/Modal.jsx';

const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'View only' };

function CreateBoardDialog({ onClose }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [template, setTemplate] = useState('basic');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const { board } = await http.post('/boards', { title: title.trim(), template });
      navigate(`/b/${board._id}`);
    } catch (err) {
      toast.error(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Create board" onClose={onClose}>
      <h2>Create board</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="board-title">Title</label>
          <input id="board-title" autoFocus value={title} maxLength={LIMITS.BOARD_TITLE} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <fieldset className="field radio-group">
          <legend>Template</legend>
          <label><input type="radio" name="tpl" checked={template === 'basic'} onChange={() => setTemplate('basic')} /> Basic: To Do, Doing, Done</label>
          <label><input type="radio" name="tpl" checked={template === 'empty'} onChange={() => setTemplate('empty')} /> Empty</label>
        </fieldset>
        <button className="btn btn--primary btn--block" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create'}</button>
      </form>
    </Modal>
  );
}

export function BoardsPage() {
  const [boards, setBoards] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    http.get('/boards')
      .then((res) => live && setBoards(res.boards))
      .catch((err) => live && err.status !== 401 && toast.error(err.message));
    return () => { live = false; };
  }, []);

  return (
    <div className="page">
      <AppHeader />
      <main className="page__body">
        <div className="page__head">
          <h1>Your boards</h1>
          {boards?.length > 0 && <button className="btn btn--primary" onClick={() => setCreating(true)}>New board</button>}
        </div>
        {boards === null && <div className="board-grid">{[0, 1, 2].map((i) => <div key={i} className="board-tile skeleton" />)}</div>}
        {boards?.length === 0 && (
          <div className="empty">
            <p>You don't have any boards yet.</p>
            <button className="btn btn--primary" onClick={() => setCreating(true)}>Create your first board</button>
          </div>
        )}
        {boards?.length > 0 && (
          <ul className="board-grid">
            {boards.map((b) => (
              <li key={b._id}>
                <Link className="board-tile" to={`/b/${b._id}`}>
                  <span className="board-tile__title">{b.title}</span>
                  <span className="board-tile__meta">{ROLE_LABEL[b.myRole]} · updated {new Date(b.updatedAt).toLocaleDateString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      {creating && <CreateBoardDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
