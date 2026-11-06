import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import Markdown from 'react-markdown';
import toast from 'react-hot-toast';
import { LIMITS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { LABEL_HEX, toLocalInput, fromLocalInput } from './cardUtils.js';
import { selectCard, selectLabels, selectMembers } from './selectors.js';
import { saveContent, setCardFields, toggleCardRef, deleteCard } from './thunks.js';

/** /b/:boardId/c/:cardId — rendered in the board's <Outlet>. */
export function CardModalRoute() {
  const { cardId } = useParams();
  const { editable, boardId } = useOutletContext();
  const navigate = useNavigate();
  const close = () => navigate(`/b/${boardId}`);

  const fromBoard = useSelector((s) => selectCard(s, cardId));
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
  return <CardModal key={card._id} card={card} editable={editable} close={close} />;
}

function CardModal({ card, editable, close }) {
  const dispatch = useDispatch();
  const labels = useSelector(selectLabels);
  const members = useSelector(selectMembers);
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [editingDesc, setEditingDesc] = useState(false);
  const dirty = title.trim() !== card.title || description !== card.description;

  // Optimistic: the displayed card updates at once, so the draft is clean again right away.
  // (Phase 5 replaces this with the draft/draftBase model, autosave, and conflict merging.)
  const save = () => {
    if (!dirty || !title.trim()) return;
    const fields = {};
    if (title.trim() !== card.title) fields.title = title.trim();
    if (description !== card.description) fields.description = description;
    dispatch(saveContent(card._id, fields)).then((r) => {
      // 409: the store now shows the teammate's version; reset the draft to it (Phase 5 merges instead).
      const current = r.error?.code === 'CONFLICT' && r.error.details?.current;
      if (current) {
        setTitle(current.title);
        setDescription(current.description);
      }
    });
    setEditingDesc(false);
  };

  // Archived cards opened by deep link aren't in the board snapshot. Ops still work for them:
  // with no displayed entity the op is a no-op until confirmed, and the confirmed card enters the store.
  const setFields = (fields) => dispatch(setCardFields(card._id, fields));
  const toggle = (kind, id, on) => dispatch(toggleCardRef(card._id, kind, id, on));
  const remove = () => {
    if (!window.confirm(`Delete card "${card.title}"? This can't be undone.`)) return;
    close();
    dispatch(deleteCard(card._id));
  };
  const archive = () => {
    close();
    dispatch(setCardFields(card._id, { archived: true }));
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
              <button className="btn btn--primary" disabled={!dirty || !title.trim()} onClick={save}>Save</button>
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
            {labels.map((l) => {
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
            {members.map((m) => {
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
              <button className="btn" onClick={archive}>Archive</button>
              <button className="btn btn--danger" onClick={remove}>Delete</button>
            </div>
          )}
        </aside>
      </div>
    </Modal>
  );
}
