import mongoose from 'mongoose';
import { EVT } from '@syncboard/shared/events';
import { LIMITS } from '@syncboard/shared/limits';
import { Card } from '../models/Card.js';
import { Comment } from '../models/Comment.js';
import { mutateBoard } from './mutateBoard.js';
import { publish } from '../sockets/publisher.js';
import { toCommentDTO } from './dto.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Comments (docs/03 — Comments, docs/11 F11). Pessimistic on the client. Creating or deleting one
 * also moves card.commentCount by ±1 in the same transaction, and the event carries the new count.
 */
const meta = (ctx, revision) => ({ revision, actorId: ctx.actorId, clientMutationId: ctx.clientMutationId });
const AUTHOR = 'name avatarColor';

/** Newest first; `cursor` is the last _id of the previous page. */
export async function listComments(cardId, { cursor, limit = LIMITS.COMMENTS_PAGE } = {}) {
  const filter = { cardId };
  if (cursor) filter._id = mongoose.trusted({ $lt: new mongoose.Types.ObjectId(cursor) });
  const page = await Comment.find(filter).sort({ _id: -1 }).limit(limit + 1).populate('authorId', AUTHOR).lean();
  const hasMore = page.length > limit;
  const comments = page.slice(0, limit).map(toCommentDTO);
  return { comments, nextCursor: hasMore ? comments.at(-1)._id : null };
}

export async function createComment(card, { body }, ctx) {
  const boardId = card.boardId;
  const { comment, commentCount, revision } = await mutateBoard(boardId, async (session) => {
    const updated = await Card.findOneAndUpdate({ _id: card._id, boardId }, { $inc: { commentCount: 1 } },
      { returnDocument: 'after', session, projection: { commentCount: 1 } }).lean();
    if (!updated) throw new ApiError(404, 'NOT_FOUND');                 // deleted concurrently
    const [created] = await Comment.create([{ cardId: card._id, boardId, authorId: ctx.actorId, body }], { session });
    return { comment: created, commentCount: updated.commentCount };
  });
  await comment.populate('authorId', AUTHOR);
  const dto = toCommentDTO(comment.toObject());
  publish(boardId, EVT.COMMENT_CREATED, { comment: dto, commentCount, ...meta(ctx, revision) });
  return { comment: dto, commentCount, revision };
}

/** Author or board owner (checked by the controller via canDelete). */
export async function deleteComment(comment, ctx) {
  const { boardId, cardId } = comment;
  const { commentCount, revision } = await mutateBoard(boardId, async (session) => {
    const res = await Comment.deleteOne({ _id: comment._id }, { session });
    if (!res.deletedCount) throw new ApiError(404, 'NOT_FOUND');
    const card = await Card.findOneAndUpdate({ _id: cardId, boardId }, { $inc: { commentCount: -1 } },
      { returnDocument: 'after', session, projection: { commentCount: 1 } }).lean();
    return { commentCount: card?.commentCount ?? 0 };
  });
  const payload = { commentId: String(comment._id), cardId: String(cardId), commentCount };
  publish(boardId, EVT.COMMENT_DELETED, { ...payload, ...meta(ctx, revision) });
  return { ...payload, revision };
}
