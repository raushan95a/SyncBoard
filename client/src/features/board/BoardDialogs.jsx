import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector, useStore } from 'react-redux';
import toast from 'react-hot-toast';
import { LIMITS, LABEL_COLORS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { Modal } from '../../components/ui/Modal.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { selectUser } from '../auth/authSlice.js';
import { LABEL_HEX } from './cardUtils.js';
import { selectLabels, selectMembers, selectMeta } from './selectors.js';
import {
  inviteMember, changeMemberRole, removeMember, createLabel, updateLabel, deleteLabel, messageFor,
} from './thunks.js';

const ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

// ---- Members (F12) -----------------------------------------------------------------------

/** Owners invite, change roles, and remove. Everyone can see the list and leave. */
export function MembersDialog({ isOwner, onClose }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const members = useSelector(selectMembers);
  const me = useSelector(selectUser);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [busy, setBusy] = useState(false);

  const invite = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    const res = await dispatch(inviteMember(email.trim(), role));
    setBusy(false);
    if (res.ok) {
      toast.success(`${res.data.member.name} was added`);
      setEmail('');
    }
  };
  const remove = async (m) => {
    const self = m.userId === me._id;
    const question = self ? 'Leave this board? You will lose access to it.' : `Remove ${m.name} from this board? They'll be unassigned from its cards.`;
    if (!window.confirm(question)) return;
    const res = await dispatch(removeMember(m.userId));
    if (res.ok && self) navigate('/boards');
  };

  return (
    <Modal title="Members" onClose={onClose}>
      <h2>Members</h2>
      <ul className="member-list">
        {members.map((m) => (
          <li key={m.userId}>
            <Avatar user={m} size={28} />
            <span className="member-list__who">
              <strong>{m.name}{m.userId === me._id && ' (you)'}</strong>
              <span className="muted">{m.email}</span>
            </span>
            {isOwner ? (
              <select className="input input--sm" value={m.role} aria-label={`Role of ${m.name}`}
                onChange={(e) => dispatch(changeMemberRole(m.userId, e.target.value))}>
                {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : <span className="badge">{ROLE_LABEL[m.role]}</span>}
            {(isOwner || m.userId === me._id) && (
              <button className="btn btn--ghost btn--danger" onClick={() => remove(m)}>
                {m.userId === me._id ? 'Leave' : 'Remove'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form className="invite" onSubmit={invite}>
          <h3>Add someone</h3>
          <div className="invite__row">
            <input className="input" type="email" placeholder="Their account email" aria-label="Email" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
            <select className="input input--sm" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button className="btn btn--primary" disabled={busy || !email.trim()}>{busy ? 'Adding…' : 'Add'}</button>
          </div>
          <p className="muted small">They need a SyncBoard account already. Invitations by email aren't supported.</p>
        </form>
      )}
    </Modal>
  );
}

// ---- Labels (F13) ------------------------------------------------------------------------

function ColorPicker({ value, onChange, label }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {LABEL_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} title={c}
          className={`swatch${value === c ? ' swatch--on' : ''}`} style={{ background: LABEL_HEX[c] }} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

function LabelRow({ label }) {
  const dispatch = useDispatch();
  const store = useStore();
  const [name, setName] = useState(label.name);
  const commitName = () => {
    const next = name.trim();
    if (next !== label.name) dispatch(updateLabel(label._id, { name: next }));
  };
  const remove = () => {
    const used = Object.values(store.getState().board.cards.byId).filter((c) => c.labelIds.includes(label._id)).length;
    const what = label.name ? `"${label.name}"` : `this ${label.color} label`;
    if (window.confirm(`Delete ${what}?${used ? ` It will be removed from ${used} card${used === 1 ? '' : 's'}.` : ''}`)) {
      dispatch(deleteLabel(label._id));
    }
  };
  return (
    <li className="label-row">
      <span className="label-row__chip" style={{ background: LABEL_HEX[label.color] }} />
      <input className="input" value={name} maxLength={LIMITS.LABEL_NAME} placeholder="No name" aria-label="Label name"
        onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
      <ColorPicker label="Label color" value={label.color} onChange={(color) => color !== label.color && dispatch(updateLabel(label._id, { color }))} />
      <button className="icon-btn icon-btn--danger" onClick={remove} aria-label={`Delete label ${label.name || label.color}`}>🗑</button>
    </li>
  );
}

export function LabelsEditor({ onClose }) {
  const dispatch = useDispatch();
  const labels = useSelector(selectLabels);
  const [name, setName] = useState('');
  const [color, setColor] = useState('green');
  const full = labels.length >= LIMITS.LABELS_PER_BOARD;

  const add = (e) => {
    e.preventDefault();
    dispatch(createLabel({ name: name.trim(), color }));
    setName('');
  };

  return (
    <Modal title="Labels" onClose={onClose} wide>
      <h2>Labels</h2>
      <ul className="label-list">
        {/* Keyed by name too: a teammate's rename resets the input (edits commit on blur, so nothing typed is lost). */}
        {labels.map((l) => <LabelRow key={`${l._id}:${l.name}`} label={l} />)}
      </ul>
      <form className="label-row label-row--new" onSubmit={add}>
        <span className="label-row__chip" style={{ background: LABEL_HEX[color] }} />
        <input className="input" value={name} maxLength={LIMITS.LABEL_NAME} placeholder="New label name (optional)" aria-label="New label name"
          onChange={(e) => setName(e.target.value)} />
        <ColorPicker label="New label color" value={color} onChange={setColor} />
        <button className="btn btn--primary" disabled={full}>Add</button>
      </form>
      {full && <p className="muted small">A board can have at most {LIMITS.LABELS_PER_BOARD} labels.</p>}
    </Modal>
  );
}

// ---- Archive (F9) ------------------------------------------------------------------------

/**
 * Archived lists and cards, newest first. Not live: it refetches when opened and after each
 * action. The board itself updates through the socket events those actions produce.
 */
export function ArchivePanel({ editable, onClose }) {
  const meta = useSelector(selectMeta);
  const [data, setData] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let live = true;
    http.get(`/boards/${meta._id}/archived`)
      .then((res) => live && setData(res))
      .catch((err) => live && err.status !== 401 && toast.error(messageFor(err, 'Could not load the archive')));
    return () => { live = false; };
  }, [meta._id, reloadKey]);

  const act = async (fn, fallback) => {
    try {
      await fn();
    } catch (err) {
      if (err.status !== 401) toast.error(messageFor(err, fallback));
    }
    reload();
  };
  const listTitle = (id) => data?.lists.find((l) => l._id === id)?.title;

  return (
    <Modal title="Archive" onClose={onClose} wide>
      <h2>Archive</h2>
      {!data && <p className="muted">Loading…</p>}
      {data && !data.lists.length && !data.cards.length && <p className="muted">Nothing is archived.</p>}

      {data?.lists.length > 0 && <>
        <h3>Lists</h3>
        <ul className="archive-list">
          {data.lists.map((l) => (
            <li key={l._id}>
              <span>{l.title}</span>
              {editable && <span className="archive-list__actions">
                <button className="btn" onClick={() => act(() => http.patch(`/lists/${l._id}`, { archived: false }), 'Could not restore the list')}>Restore</button>
                <button className="btn btn--ghost btn--danger" onClick={() => window.confirm(`Delete list "${l.title}" and all of its cards permanently?`)
                  && act(() => http.del(`/lists/${l._id}`), 'Could not delete the list')}>Delete</button>
              </span>}
            </li>
          ))}
        </ul>
      </>}

      {data?.cards.length > 0 && <>
        <h3>Cards</h3>
        <ul className="archive-list">
          {data.cards.map((c) => (
            <li key={c._id}>
              <span>{c.title}{listTitle(c.listId) && <span className="muted small"> · in archived list “{listTitle(c.listId)}”</span>}</span>
              {editable && <span className="archive-list__actions">
                <button className="btn" onClick={() => act(() => http.patch(`/cards/${c._id}`, { archived: false }), 'Could not restore the card')}>Restore</button>
                <button className="btn btn--ghost btn--danger" onClick={() => window.confirm(`Delete card "${c.title}" permanently?`)
                  && act(() => http.del(`/cards/${c._id}`), 'Could not delete the card')}>Delete</button>
              </span>}
            </li>
          ))}
        </ul>
      </>}
    </Modal>
  );
}
