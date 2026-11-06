import { Link } from 'react-router-dom';
import { LIMITS } from '@syncboard/shared/limits';
import { http } from '../../api/http.js';
import { EditableText, InlineAdd } from '../../components/ui/InlineForm.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { LABEL_HEX, dueState, formatDue } from './cardUtils.js';

export function ListColumn({ list, cards, board, editable, run }) {
  const rename = (title) => run(() => http.patch(`/lists/${list._id}`, { title }), 'Could not rename the list');
  const archive = () => run(() => http.patch(`/lists/${list._id}`, { archived: true }), 'Could not archive the list');
  const remove = () => {
    const msg = cards.length ? `Delete list "${list.title}" and its ${cards.length} card${cards.length === 1 ? '' : 's'}?` : `Delete list "${list.title}"?`;
    if (window.confirm(msg)) run(() => http.del(`/lists/${list._id}`), 'Could not delete the list');
  };
  const addCard = async (title) => (await run(() => http.post(`/lists/${list._id}/cards`, { title }), 'Could not add the card')).ok;

  return (
    <section className="list" aria-label={`List ${list.title}`} data-list={list.title}>
      <header className="list__head">
        <EditableText as="h2" className="list__title" value={list.title} editable={editable} maxLength={LIMITS.LIST_TITLE} label="list title" onSave={rename} />
        {editable && (
          <div className="list__actions">
            <button className="icon-btn" onClick={archive} title="Archive list" aria-label={`Archive list ${list.title}`}>⤓</button>
            <button className="icon-btn icon-btn--danger" onClick={remove} title="Delete list" aria-label={`Delete list ${list.title}`}>🗑</button>
          </div>
        )}
      </header>
      <ul className="list__cards">
        {cards.map((card) => <li key={card._id}><CardItem card={card} board={board} /></li>)}
      </ul>
      {editable && <InlineAdd label="Add a card" placeholder="Card title" maxLength={LIMITS.CARD_TITLE} onSubmit={addCard} multiline />}
    </section>
  );
}

function CardItem({ card, board }) {
  const labels = board.labels.filter((l) => card.labelIds.includes(l._id));
  const assignees = board.members.filter((m) => card.assigneeIds.includes(m.userId));
  const due = dueState(card);

  return (
    <Link className={`card${card.completed ? ' card--done' : ''}`} to={`c/${card._id}`} aria-label={`Open card ${card.title}`}>
      {labels.length > 0 && (
        <span className="card__labels">
          {labels.map((l) => <span key={l._id} className="label-pip" style={{ background: LABEL_HEX[l.color] }} title={l.name || l.color} />)}
        </span>
      )}
      <span className="card__title">{card.title}</span>
      {(due || card.description || card.commentCount > 0 || assignees.length > 0) && (
        <span className="card__meta">
          {due && <span className={`chip chip--${due}`}>{due === 'done' ? '✓ ' : ''}{formatDue(card.dueDate)}</span>}
          {card.description && <span className="card__icon" title="Has a description">≡</span>}
          {card.commentCount > 0 && <span className="card__icon" title="Comments">💬 {card.commentCount}</span>}
          <span className="card__assignees">{assignees.map((m) => <Avatar key={m.userId} user={m} size={22} />)}</span>
        </span>
      )}
    </Link>
  );
}
