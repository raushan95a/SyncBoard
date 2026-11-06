import { EVT } from '@syncboard/shared/events';
import { LIMITS } from '@syncboard/shared/limits';
import { Board } from '../models/Board.js';
import { List } from '../models/List.js';
import { Card } from '../models/Card.js';
import { Comment } from '../models/Comment.js';
import { mutateBoard } from './mutateBoard.js';
import { appendCardPosition } from './positions.js';
import { findReplay, retryOnDuplicate } from './idempotentCreate.js';
import { publish } from '../sockets/publisher.js';
import { ApiError } from '../utils/ApiError.js';

const meta = (ctx, revision) => ({ revision, actorId: ctx.actorId, clientMutationId: ctx.clientMutationId });
const AFTER = { returnDocument: 'after' };

/** Publishes card:updated and returns the REST payload. */
function updated(boardId, ctx, { card, revision, rebalanced }) {
  publish(boardId, EVT.CARD_UPDATED, { card, rebalanced, ...meta(ctx, revision) });
  return { card, revision };
}

/** Atomic update scoped to the board; 404 if the card vanished concurrently. */
async function updateCard(cardId, boardId, update, session) {
  const card = await Card.findOneAndUpdate({ _id: cardId, boardId }, update, { ...AFTER, runValidators: true, session }).lean();
  if (!card) throw new ApiError(404, 'NOT_FOUND');
  return card;
}

export async function createCard(listId, boardId, { _id, title }, ctx) {
  const replay = () => findReplay(Card, _id, ctx.actorId, boardId).then((r) => r && { card: r.doc, revision: r.revision, replayed: true });
  const existing = await replay();
  if (existing) return existing;

  const result = await retryOnDuplicate(() => mutateBoard(boardId, async (session) => {
    const list = await List.findOne({ _id: listId, boardId, archived: false }).session(session).lean();
    if (!list) throw new ApiError(404, 'NOT_FOUND');
    const count = await Card.countDocuments({ boardId, archived: false }).session(session);
    if (count >= LIMITS.CARDS_PER_BOARD) throw new ApiError(422, 'LIMIT_REACHED', `A board can have at most ${LIMITS.CARDS_PER_BOARD} cards`);
    const { position, rebalanced } = await appendCardPosition(listId, session);
    const [card] = await Card.create([{ ...(_id && { _id }), boardId, listId, title, position, createdBy: ctx.actorId }], { session });
    return { card: card.toObject(), rebalanced };
  }), replay);

  if (!result.replayed) {
    publish(boardId, EVT.CARD_CREATED, { card: result.card, rebalanced: result.rebalanced, ...meta(ctx, result.revision) });
  }
  return result;
}

/** Card plus the first page of comments (newest first). Archived cards are readable too. */
export async function getCard(card) {
  const page = await Comment.find({ cardId: card._id }).sort({ _id: -1 }).limit(LIMITS.COMMENTS_PAGE + 1).lean();
  const hasMore = page.length > LIMITS.COMMENTS_PAGE;
  const comments = page.slice(0, LIMITS.COMMENTS_PAGE);
  return { card, comments, nextCursor: hasMore ? String(comments.at(-1)._id) : null };
}

/**
 * Compare-and-set on `version` (docs/02 — Versioning). The client's version is part of the
 * filter, so an edit based on a stale copy is rejected with 409 and the current card.
 */
export async function updateContent(cardId, boardId, { title, description, version }, ctx) {
  const result = await mutateBoard(boardId, async (session) => {
    const $set = {};
    if (title !== undefined) $set.title = title;
    if (description !== undefined) $set.description = description;
    const card = await Card.findOneAndUpdate(
      { _id: cardId, boardId, version },
      { $set, $inc: { version: 1 } },
      { ...AFTER, runValidators: true, session },
    ).lean();
    if (!card) {
      const current = await Card.findOne({ _id: cardId, boardId }).session(session).lean();
      throw current
        ? new ApiError(409, 'CONFLICT', 'This card was changed by someone else', { current })
        : new ApiError(404, 'NOT_FOUND');
    }
    return { card };
  });
  return updated(boardId, ctx, result);
}

/**
 * Last-write-wins fields. Never bumps `version`, so it can't cause a false conflict on a
 * concurrent text edit. Restoring (archived: false) appends the card to its list's end;
 * if that list is archived → 422.
 */
export async function updateFields(cardId, boardId, { completed, dueDate, archived }, ctx) {
  const result = await mutateBoard(boardId, async (session) => {
    const current = await Card.findOne({ _id: cardId, boardId }).session(session).lean();
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    const $set = {};
    if (completed !== undefined) $set.completed = completed;
    if (dueDate !== undefined) $set.dueDate = dueDate === null ? null : new Date(dueDate);
    let rebalanced;
    if (archived !== undefined) {
      $set.archived = archived;
      if (!archived && current.archived) {
        const list = await List.findOne({ _id: current.listId, boardId }).session(session).lean();
        if (!list) throw new ApiError(404, 'NOT_FOUND');
        if (list.archived) throw new ApiError(422, 'LIST_ARCHIVED', 'Restore the list first');
        ({ position: $set.position, rebalanced } = await appendCardPosition(current.listId, session));
      }
    }
    return { card: await updateCard(cardId, boardId, { $set }, session), rebalanced };
  });
  return updated(boardId, ctx, result);
}

export async function addAssignee(cardId, boardId, userId, ctx) {
  const result = await mutateBoard(boardId, async (session) => {
    const isMember = await Board.exists({ _id: boardId, 'members.userId': userId }).session(session);
    if (!isMember) throw new ApiError(400, 'VALIDATION_ERROR', 'Not a board member');
    return { card: await updateCard(cardId, boardId, { $addToSet: { assigneeIds: userId } }, session) };
  });
  return updated(boardId, ctx, result);
}

export async function removeAssignee(cardId, boardId, userId, ctx) {
  const result = await mutateBoard(boardId, async (session) => ({
    card: await updateCard(cardId, boardId, { $pull: { assigneeIds: userId } }, session),
  }));
  return updated(boardId, ctx, result);
}

export async function addLabel(cardId, boardId, labelId, ctx) {
  const result = await mutateBoard(boardId, async (session) => {
    const exists = await Board.exists({ _id: boardId, 'labels._id': labelId }).session(session);
    if (!exists) throw new ApiError(400, 'VALIDATION_ERROR', 'Not one of this board\'s labels');
    return { card: await updateCard(cardId, boardId, { $addToSet: { labelIds: labelId } }, session) };
  });
  return updated(boardId, ctx, result);
}

export async function removeLabel(cardId, boardId, labelId, ctx) {
  const result = await mutateBoard(boardId, async (session) => ({
    card: await updateCard(cardId, boardId, { $pull: { labelIds: labelId } }, session),
  }));
  return updated(boardId, ctx, result);
}

/** Also deletes the card's comments. */
export async function deleteCard(cardId, boardId, ctx) {
  const { listId, revision } = await mutateBoard(boardId, async (session) => {
    const card = await Card.findOne({ _id: cardId, boardId }).session(session).lean();
    if (!card) throw new ApiError(404, 'NOT_FOUND');
    await Comment.deleteMany({ cardId }, { session });
    await Card.deleteOne({ _id: cardId }, { session });
    return { listId: String(card.listId) };
  });
  publish(boardId, EVT.CARD_DELETED, { cardId: String(cardId), listId, ...meta(ctx, revision) });
  return { cardId: String(cardId), listId, revision };
}
