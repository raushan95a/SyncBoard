import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { LIMITS } from '@syncboard/shared/limits';
import { EditableText, InlineAdd } from '../../components/ui/InlineForm.jsx';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { LABEL_HEX, dueState, formatDue } from './cardUtils.js';
import { selectList, selectCardIds, selectCard, selectLabels, selectMembers, selectEditors } from './selectors.js';
import { selectUser } from '../auth/authSlice.js';
import { renameList, archiveList, deleteList, createCard } from './thunks.js';

/**
 * One column. Memoized and selected by id: a card move re-renders only the two affected
 * columns and the moved card (docs/05 — Performance).
 */
export const ListColumn = memo(function ListColumn({ listId, index, editable, canDrag }) {
  const dispatch = useDispatch();
  const list = useSelector((s) => selectList(s, listId));
  const cardIds = useSelector((s) => selectCardIds(s, listId));
  if (!list) return null;

  const remove = () => {
    const n = cardIds.length;
    const msg = n ? `Delete list "${list.title}" and its ${n} card${n === 1 ? '' : 's'}?` : `Delete list "${list.title}"?`;
    if (window.confirm(msg)) dispatch(deleteList(listId));
  };

  return (
    <Draggable draggableId={listId} index={index} isDragDisabled={!canDrag}>
      {(drag, snap) => (
        <section className={`list${snap.isDragging ? ' list--dragging' : ''}`} aria-label={`List ${list.title}`}
          data-list={list.title} ref={drag.innerRef} {...drag.draggableProps}>
          <header className="list__head" {...drag.dragHandleProps}>
            <EditableText as="h2" className="list__title" value={list.title} editable={editable} maxLength={LIMITS.LIST_TITLE}
              label="list title" onSave={(title) => dispatch(renameList(listId, title))} />
            {editable && (
              <div className="list__actions">
                <button className="icon-btn" onClick={() => dispatch(archiveList(listId))} title="Archive list" aria-label={`Archive list ${list.title}`}>⤓</button>
                <button className="icon-btn icon-btn--danger" onClick={remove} title="Delete list" aria-label={`Delete list ${list.title}`}>🗑</button>
              </div>
            )}
          </header>
          <Droppable droppableId={listId} type="CARD">
            {(drop, dropSnap) => (
              <ul className={`list__cards${dropSnap.isDraggingOver ? ' list__cards--over' : ''}`} ref={drop.innerRef} {...drop.droppableProps}>
                {cardIds.map((cardId, i) => <CardItem key={cardId} cardId={cardId} index={i} canDrag={canDrag} />)}
                {drop.placeholder}
              </ul>
            )}
          </Droppable>
          {editable && (
            <InlineAdd label="Add a card" placeholder="Card title" maxLength={LIMITS.CARD_TITLE} multiline
              onSubmit={(title) => { dispatch(createCard(listId, title)); return true; }} />
          )}
        </section>
      )}
    </Draggable>
  );
});

const CardItem = memo(function CardItem({ cardId, index, canDrag }) {
  const card = useSelector((s) => selectCard(s, cardId));
  const allLabels = useSelector(selectLabels);
  const members = useSelector(selectMembers);
  const editors = useSelector((s) => selectEditors(s, cardId));
  const myId = useSelector(selectUser)?._id;
  if (!card) return null;
  const editingBy = Object.values(editors).filter((u) => u.id !== myId);

  const labels = allLabels.filter((l) => card.labelIds.includes(l._id));
  const assignees = members.filter((m) => card.assigneeIds.includes(m.userId));
  const due = dueState(card);

  return (
    <Draggable draggableId={cardId} index={index} isDragDisabled={!canDrag}>
      {(drag, snap) => (
        <li ref={drag.innerRef} {...drag.draggableProps} {...drag.dragHandleProps}>
          <Link className={`card${card.completed ? ' card--done' : ''}${snap.isDragging ? ' card--dragging' : ''}`}
            to={`c/${card._id}`} aria-label={`Open card ${card.title}`} draggable={false}>
            {labels.length > 0 && (
              <span className="card__labels">
                {labels.map((l) => <span key={l._id} className="label-pip" style={{ background: LABEL_HEX[l.color] }} title={l.name || l.color} />)}
              </span>
            )}
            <span className="card__title">{card.title}</span>
            {editingBy.length > 0 && <span className="card__editing">✎ {editingBy.map((u) => u.name).join(', ')} editing…</span>}
            {(due || card.description || card.commentCount > 0 || assignees.length > 0) && (
              <span className="card__meta">
                {due && <span className={`chip chip--${due}`}>{due === 'done' ? '✓ ' : ''}{formatDue(card.dueDate)}</span>}
                {card.description && <span className="card__icon" title="Has a description">≡</span>}
                {card.commentCount > 0 && <span className="card__icon" title="Comments">💬 {card.commentCount}</span>}
                <span className="card__assignees">{assignees.map((m) => <Avatar key={m.userId} user={m} size={22} />)}</span>
              </span>
            )}
          </Link>
        </li>
      )}
    </Draggable>
  );
});
