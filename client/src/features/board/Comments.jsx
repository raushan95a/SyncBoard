import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { EVT } from '@syncboard/shared/events';
import { LIMITS } from '@syncboard/shared/limits';
import { canManageBoard } from '@syncboard/shared/roles';
import { http } from '../../api/http.js';
import { getSocket } from '../../api/socket.js';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { selectUser } from '../auth/authSlice.js';
import { selectMyRole } from './selectors.js';
import { messageFor } from './thunks.js';

/** Newest first, no duplicates (a comment can arrive by socket before its POST resolves). */
function merge(list, incoming) {
  const seen = new Set(list.map((c) => c._id));
  const fresh = incoming.filter((c) => !seen.has(c._id));
  return [...fresh, ...list].sort((a, b) => (a._id < b._id ? 1 : -1));
}

/**
 * Comments in the card modal (docs/11 F11). Pessimistic: comments aren't part of board state.
 * The card's commentCount (on its face) comes from the ordered event stream; this list listens to
 * the same events directly, and refetches the first page after a reconnect.
 */
export function Comments({ cardId, editable, onCardGone }) {
  const me = useSelector(selectUser);
  const isOwner = canManageBoard(useSelector(selectMyRole));
  const [comments, setComments] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirst = useCallback(() => http.get(`/cards/${cardId}/comments`)
    .then((res) => {
      setComments(res.comments);
      setCursor(res.nextCursor);
    })
    .catch((err) => err.status !== 401 && err.status !== 404 && toast.error(messageFor(err, 'Could not load comments'))), [cardId]);

  useEffect(() => {
    loadFirst();
    const s = getSocket();
    const onCreated = (p) => p.comment?.cardId === cardId && setComments((list) => merge(list ?? [], [p.comment]));
    const onDeleted = (p) => p.cardId === cardId && setComments((list) => list?.filter((c) => c._id !== p.commentId) ?? list);
    s.on(EVT.COMMENT_CREATED, onCreated);
    s.on(EVT.COMMENT_DELETED, onDeleted);
    s.on('connect', loadFirst);
    return () => {
      s.off(EVT.COMMENT_CREATED, onCreated);
      s.off(EVT.COMMENT_DELETED, onDeleted);
      s.off('connect', loadFirst);
    };
  }, [cardId, loadFirst]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await http.get(`/cards/${cardId}/comments?cursor=${cursor}`);
      setComments((list) => merge(list ?? [], res.comments));
      setCursor(res.nextCursor);
    } catch (err) {
      if (err.status !== 401) toast.error(messageFor(err, 'Could not load more comments'));
    } finally {
      setLoadingMore(false);
    }
  };

  const post = async (e) => {
    e.preventDefault();
    const text = body.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await http.post(`/cards/${cardId}/comments`, { body: text });
      setComments((list) => merge(list ?? [], [res.comment]));
      setBody('');
    } catch (err) {
      if (err.status === 404) onCardGone?.();
      else if (err.status !== 401) toast.error(messageFor(err, 'Could not post the comment'));
    } finally {
      setPosting(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await http.del(`/comments/${c._id}`);
      setComments((list) => list.filter((x) => x._id !== c._id));
    } catch (err) {
      if (err.status !== 401) toast.error(messageFor(err, 'Could not delete the comment'));
    }
  };

  return (
    <section className="comments" aria-label="Comments">
      <h3>Comments</h3>
      {editable && (
        <form className="comments__form" onSubmit={post}>
          <textarea className="card-modal__desc" rows={2} value={body} maxLength={LIMITS.COMMENT} placeholder="Write a comment…"
            aria-label="New comment" onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' && (e.ctrlKey || e.metaKey) ? post(e) : undefined)} />
          <button className="btn btn--primary" disabled={posting || !body.trim()}>{posting ? 'Posting…' : 'Comment'}</button>
        </form>
      )}
      {comments === null && <p className="muted">Loading…</p>}
      {comments?.length === 0 && <p className="muted">No comments yet.</p>}
      <ul className="comments__list">
        {comments?.map((c) => (
          <li key={c._id} className="comment">
            <Avatar user={c.author ?? { name: 'Deleted user' }} size={26} />
            <div className="comment__main">
              <div className="comment__head">
                <strong>{c.author?.name ?? 'Deleted user'}</strong>
                <span className="muted small">{new Date(c.createdAt).toLocaleString()}</span>
                {(c.authorId === me?._id || isOwner) && (
                  <button className="btn btn--ghost btn--danger btn--xs" onClick={() => remove(c)}>Delete</button>
                )}
              </div>
              <p className="comment__body">{c.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {cursor && <button className="btn btn--ghost" onClick={loadMore} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Load more'}</button>}
    </section>
  );
}
