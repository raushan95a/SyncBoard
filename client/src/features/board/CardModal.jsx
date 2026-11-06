import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import Markdown from 'react-markdown';
import toast from 'react-hot-toast';
import { LIMITS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { selectUser } from '../auth/authSlice.js';
import { LABEL_HEX, toLocalInput, fromLocalInput } from './cardUtils.js';
import { selectCard, selectLabels, selectMembers, selectEditors } from './selectors.js';
import { setCardFields, toggleCardRef, deleteCard } from './thunks.js';
import { useCardDraft } from './useCardDraft.js';
import { useEditingSignal } from './useEditingSignal.js';
import { ConflictBanner } from './ConflictBanner.jsx';
import { Comments } from './Comments.jsx';

/** /b/:boardId/c/:cardId — rendered in the board's <Outlet>. */
export function CardModalRoute() {
  const { cardId } = useParams();
  const { editable, boardId } = useOutletContext();
  const navigate = useNavigate();
  const { search } = useLocation();
  const close = () => navigate(`/b/${boardId}${search}`);

  const fromBoard = useSelector((s) => selectCard(s, cardId));
  const [fetched, setFetched] = useState(null);
  // Remember whether the card was ever on the board, to tell "deleted while open" from a deep link.
  const [seen, setSeen] = useState(false);
  if (fromBoard && !seen) setSeen(true);

  useEffect(() => {
    if (fromBoard) return undefined;
    if (seen) {
      // Deleted (by a teammate, or a cascade) while the modal was open (docs/05).
      toast('This card was deleted');
      navigate(`/b/${boardId}${search}`, { replace: true });
      return undefined;
    }
    // Archived cards aren't in the board snapshot; deep links to them fetch the card (docs/11 F3).
    let live = true;
    http.get(`/cards/${cardId}`)
      .then((res) => live && setFetched(res.card))
      .catch(() => {
        if (!live) return;
        toast.error('Card not found');
        navigate(`/b/${boardId}${search}`, { replace: true });
      });
    return () => { live = false; };
  }, [cardId, fromBoard, seen, boardId, navigate, search]);

  const card = fromBoard ?? fetched;
  if (!card) return null;
  return <CardModal key={card._id} card={card} editable={editable} close={close} />;
}

const nameOf = (members, userId) => members.find((m) => m.userId === userId)?.name ?? null;

function CardModal({ card, editable, close }) {
  const dispatch = useDispatch();
  const labels = useSelector(selectLabels);
  const members = useSelector(selectMembers);
  const me = useSelector(selectUser);
  const editors = useSelector((s) => selectEditors(s, card._id));
  const others = Object.values(editors).filter((u) => u.id !== me?._id);

  const d = useCardDraft(card);
  const signal = useEditingSignal(card._id);
  const [editingDesc, setEditingDesc] = useState(!card.description);

  // Simple fields save instantly as ops; they never conflict (docs/05).
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

  const pill = (field) => field in d.changedBy && (
    <span className="pill" title="Your text is kept. Saving will ask how to combine it.">
      {nameOf(members, d.changedBy[field]) ?? 'Someone'} changed this
    </span>
  );
  const status = d.conflict ? 'Not saved: resolve the conflict' : d.saving ? 'Saving…' : d.dirty.length ? 'Unsaved changes' : 'All changes saved';

  return (
    <Modal title={d.draft.title || card.title} onClose={close} wide>
      {card.archived && (
        <div className="banner banner--warn">
          This card is archived.
          {editable && <>
            <button className="btn" onClick={() => setFields({ archived: false })}>Restore</button>
            <button className="btn btn--danger" onClick={remove}>Delete permanently</button>
          </>}
        </div>
      )}
      {d.conflict && (
        <ConflictBanner conflict={d.conflict} byName={nameOf(members, d.conflict.by)}
          onTheirs={d.resolve.theirs} onMine={d.resolve.mine} onCopy={d.resolve.copy} />
      )}
      {others.length > 0 && (
        <p className="editing-note" role="status">✎ {others.map((u) => u.name).join(', ')} {others.length === 1 ? 'is' : 'are'} editing…</p>
      )}

      <div className="card-modal">
        <div className="card-modal__main">
          {editable ? (
            <div className="field-row">
              <input className="card-modal__title" value={d.draft.title} maxLength={LIMITS.CARD_TITLE} aria-label="Card title"
                onChange={(e) => d.setField('title', e.target.value)} onFocus={signal.onFocus}
                onBlur={() => { signal.onBlur(); d.flush(); }} />
              {pill('title')}
            </div>
          ) : <h2 className="card-modal__title">{card.title}</h2>}

          <h3>Description {editable && pill('description')}</h3>
          {editable && editingDesc ? (
            <textarea className="card-modal__desc" value={d.draft.description} maxLength={LIMITS.DESCRIPTION} rows={8}
              placeholder="Add a more detailed description… (Markdown supported)" aria-label="Description"
              onChange={(e) => d.setField('description', e.target.value)} onFocus={signal.onFocus}
              onBlur={() => {
                signal.onBlur();
                d.flush();
                if (d.draft.description) setEditingDesc(false);
              }} />
          ) : (
            <div className={`markdown${editable ? ' editable' : ''}`} onClick={() => editable && setEditingDesc(true)}>
              {d.draft.description ? <Markdown>{d.draft.description}</Markdown> : <p className="muted">No description.</p>}
            </div>
          )}
          {editable && <p className="muted save-status" aria-live="polite">{status}</p>}

          <Comments cardId={card._id} editable={editable} onCardGone={() => { toast('This card was deleted'); close(); }} />
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
