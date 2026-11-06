import mongoose from 'mongoose';
import { EVT } from '@syncboard/shared/events';
import { LIMITS } from '@syncboard/shared/limits';
import { List } from '../models/List.js';
import { Card } from '../models/Card.js';
import { Comment } from '../models/Comment.js';
import { mutateBoard } from './mutateBoard.js';
import { appendListPosition } from './positions.js';
import { findReplay, retryOnDuplicate } from './idempotentCreate.js';
import { assertRoleInTx } from '../middleware/loadResource.js';
import { publish } from '../sockets/publisher.js';
import { ApiError } from '../utils/ApiError.js';

const meta = (ctx, revision) => ({ revision, actorId: ctx.actorId, clientMutationId: ctx.clientMutationId });

export async function createList(boardId, { _id, title }, ctx) {
  const replay = () => findReplay(List, _id, ctx.actorId, boardId).then((r) => r && { list: r.doc, revision: r.revision, replayed: true });
  const existing = await replay();
  if (existing) return existing;

  const result = await retryOnDuplicate(() => mutateBoard(boardId, async (session) => {
    const count = await List.countDocuments({ boardId, archived: false }).session(session);
    if (count >= LIMITS.LISTS_PER_BOARD) throw new ApiError(422, 'LIMIT_REACHED', `A board can have at most ${LIMITS.LISTS_PER_BOARD} lists`);
    const { position, rebalanced } = await appendListPosition(boardId, session);
    const [list] = await List.create([{ ...(_id && { _id }), boardId, title, position, createdBy: ctx.actorId }], { session });
    return { list: list.toObject(), rebalanced };
  }), replay);

  if (!result.replayed) {
    publish(boardId, EVT.LIST_CREATED, { list: result.list, rebalanced: result.rebalanced, ...meta(ctx, result.revision) });
  }
  return result;
}

/** title and archived are last-write-wins. Restoring appends the list to the end. */
export async function updateList(listId, boardId, { title, archived }, ctx) {
  const result = await mutateBoard(boardId, async (session) => {
    const current = await List.findOne({ _id: listId, boardId }).session(session).lean();
    if (!current) throw new ApiError(404, 'NOT_FOUND');
    const $set = {};
    if (title !== undefined) $set.title = title;
    let rebalanced;
    if (archived !== undefined) {
      $set.archived = archived;
      if (!archived && current.archived) {
        ({ position: $set.position, rebalanced } = await appendListPosition(boardId, session));
      }
    }
    const list = await List.findByIdAndUpdate(listId, { $set }, { returnDocument: 'after', session }).lean();
    return { list, rebalanced };
  });
  publish(boardId, EVT.LIST_UPDATED, { list: result.list, rebalanced: result.rebalanced, ...meta(ctx, result.revision) });
  return result;
}

/** Cascades to the list's cards and their comments. */
export async function deleteList(listId, boardId, ctx) {
  const { revision } = await mutateBoard(boardId, async (session) => {
    await assertRoleInTx(boardId, ctx.actorId, 'editor', session);
    const list = await List.findOne({ _id: listId, boardId }).session(session).lean();
    if (!list) throw new ApiError(404, 'NOT_FOUND');
    const cardIds = await Card.find({ listId }).distinct('_id').session(session);
    if (cardIds.length) await Comment.deleteMany({ cardId: mongoose.trusted({ $in: cardIds }) }, { session });
    await Card.deleteMany({ listId }, { session });
    await List.deleteOne({ _id: listId }, { session });
    return {};
  });
  publish(boardId, EVT.LIST_DELETED, { listId: String(listId), ...meta(ctx, revision) });
  return { listId: String(listId), revision };
}
