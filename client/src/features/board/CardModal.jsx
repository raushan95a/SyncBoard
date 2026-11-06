import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import toast from 'react-hot-toast';
import { LIMITS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { LABEL_HEX, toLocalInput, fromLocalInput } from './cardUtils.js';

/** /b/:boardId/c/:cardId — rendered in the board's <Outlet>. */
export function CardModalRoute() {
  const { cardId } = useParams();
  const { board, editable, boardId } = useOutletContext();
  const navigate = useNavigate();
  const close = () => navigate(`/b/${boardId}`);

  const fromBoard = board.data.cards.find((c) => c._id === cardId);
  // Archived cards aren't in the board snapshot; deep links to them fetch the card (docs/11 F3).
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (fromBoard) return;
    let live = true;
    http.get(`/cards/${cardId}`)
      .then((res) => live && setFetched(res.card))
      .catch(() => {
        if (!live) return;
        toast.error('Card not found');
        navigate(`/b/${boardId}`, { replace: true });
      });
    return () => { live = false; };
  }, [cardId, fromBoard, boardId, navigate]);

  const card = fromBoard ?? fetched;
  if (!card) return null;
  // Remount (fresh draft) whenever the server version changes.
  return <CardModal key={`${card._id}:${card.version}`} card={card} board={board} editable={editable} close={close} />;
}

function CardModal({ card, board, editable, close }) {
  const { run, data } = board;
  const meta = data.board;
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [editingDesc, setEditingDesc] = useState(false);
  const dirty = title.trim() !== card.title || description !== card.description;

  const saveContent = async () => {
    if (!dirty || !title.trim()) return;
    const body = { version: card.version };
    if (title.trim() !== card.title) body.title = title.trim();
    if (description !== card.description) body.description = description;
    const res = await run(() => http.patch(`/cards/${card._id}/content`, body), 'Could not save the card');
    if (res.ok) setEditingDesc(false);
  };

  const setFields = (fields) => run(() => http.patch(`/cards/${card._id}`, fields), 'Could not update the card');
  const toggle = (kind, id, on) => run(() => (on
    ? http.del(`/cards/${card._id}/${kind}/${id}`)
    : http.post(`/cards/${card._id}/${kind}`, kind === 'labels' ? { labelId: id } : { userId: id })), 'Could not update the card');
  const remove = async () => {
    if (!window.confirm(`Delete card "${card.title}"? This can't be undone.`)) return;
    const res = await run(() => http.del(`/cards/${card._id}`), 'Could not delete the card');
    if (res.ok) close();
  };

  return (
    <Modal title={card.title} onClose={close} wide>
      {card.archived && (
        <div className="banner banner--warn">
          This card is archived.
          {editable && <>
            <button className="btn" onClick={() => setFields({ archived: false })}>Restore</button>
            <button className="btn btn--danger" onClick={remove}>Delete permanently</button>
          </>}
        </div>
      )}

      <div className="card-modal">
        <div className="card-modal__main">
          {editable
            ? <input className="card-modal__title" value={title} maxLength={LIMITS.CARD_TITLE} aria-label="Card title" onChange={(e) => setTitle(e.target.value)} />
            : <h2 className="card-modal__title">{card.title}</h2>}

          <h3>Description</h3>
          {editable && (editingDesc || !card.description) ? (
            <textarea className="card-modal__desc" value={description} maxLength={LIMITS.DESCRIPTION} rows={8}
              placeholder="Add a more detailed description… (Markdown supported)" aria-label="Description"
              onChange={(e) => setDescription(e.target.value)} />
          ) : (
            <div className={`markdown${editable ? ' editable' : ''}`} onClick={() => editable && setEditingDesc(true)}>
              {card.description ? <Markdown>{card.description}</Markdown> : <p className="muted">No description.</p>}
            </div>
          )}
          {editable && (
            <div className="card-modal__save">
              <button className="btn btn--primary" disabled={!dirty || !title.trim()} onClick={saveContent}>Save</button>
              {dirty && <button className="btn btn--ghost" onClick={() => { setTitle(card.title); setDescription(card.description); setEditingDesc(false); }}>Discard</button>}
              {dirty && <span className="muted">Unsaved changes</span>}
            </div>
          )}
        </div>

        <aside className="card-modal__side">
          <label className="check">
            <input type="checkbox" checked={card.completed} disabled={!editable} onChange={(e) => setFields({ completed: e.target.checked })} />
            Done
          </label>

          <h3>Due date</h3>
          <input type="datetime-local" className="input" disabled={!editable} value={toLocalInput(card.dueDate)}
            aria-label="Due date" onChange={(e) => setFields({ dueDate: fromLocalInput(e.target.value) })} />

          <h3>Labels</h3>
          <div className="chips">
            {meta.labels.map((l) => {
              const on = card.labelIds.includes(l._id);
              return (
                <button key={l._id} className={`label-chip${on ? ' label-chip--on' : ''}`} disabled={!editable}
                  style={{ '--c': LABEL_HEX[l.color] }} aria-pressed={on} onClick={() => toggle('labels', l._id, on)}>
                  {l.name || l.color}
                </button>
              );
            })}
          </div>

          <h3>Assignees</h3>
          <div className="chips">
            {meta.members.map((m) => {
              const on = card.assigneeIds.includes(m.userId);
              return (
                <button key={m.userId} className={`member-chip${on ? ' member-chip--on' : ''}`} disabled={!editable}
                  aria-pressed={on} onClick={() => toggle('assignees', m.userId, on)}>
                  <Avatar user={m} size={20} /> {m.name}
                </button>
              );
            })}
          </div>

          {editable && !card.archived && (
            <div className="card-modal__danger">
              <button className="btn" onClick={() => setFields({ archived: true }).then(() => close())}>Archive</button>
              <button className="btn btn--danger" onClick={remove}>Delete</button>
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}
