import mongoose from 'mongoose';
import { EVT } from '@syncboard/shared/events';
import { LIMITS } from '@syncboard/shared/limits';
import { Board } from '../models/Board.js';
import { Card } from '../models/Card.js';
import { mutateBoard } from './mutateBoard.js';
import { publish } from '../sockets/publisher.js';
import { toBoardMetaDTO } from './dto.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Board-level labels (docs/03 — Labels, docs/11 F13). Cards store only label ids, so a rename or
 * recolor touches one document. A delete also pulls the id from every card, in one transaction.
 */
const meta = (ctx, revision) => ({ revision, actorId: ctx.actorId, clientMutationId: ctx.clientMutationId });
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const AFTER = { returnDocument: 'after', runValidators: true };

function boardUpdated(boardId, ctx, { board, revision }) {
  const dto = toBoardMetaDTO(board);
  publish(boardId, EVT.BOARD_UPDATED, { board: dto, ...meta(ctx, revision) });
  return { board: dto, revision };
}

export async function createLabel(boardId, { _id, name, color }, ctx) {
  const result = await mutateBoard(boardId, async (session) => {
    const current = await Board.findById(boardId, { labels: 1 }).session(session).lean();
    if (current.labels.length >= LIMITS.LABELS_PER_BOARD) {
      throw new ApiError(422, 'LIMIT_REACHED', `A board can have at most ${LIMITS.LABELS_PER_BOARD} labels`);
    }
    if (_id && current.labels.some((l) => String(l._id) === _id)) {
      return { board: await Board.findById(boardId).session(session).lean() };   // idempotent retry
    }
    const board = await Board.findByIdAndUpdate(boardId,
      { $push: { labels: { ...(_id && { _id: oid(_id) }), name, color } } }, { ...AFTER, session }).lean();
    return { board };
  });
  return boardUpdated(boardId, ctx, result);
}

export async function updateLabel(boardId, labelId, { name, color }, ctx) {
  const $set = {};
  if (name !== undefined) $set['labels.$.name'] = name;
  if (color !== undefined) $set['labels.$.color'] = color;
  const result = await mutateBoard(boardId, async (session) => {
    const board = await Board.findOneAndUpdate({ _id: boardId, 'labels._id': oid(labelId) }, { $set }, { ...AFTER, session }).lean();
    if (!board) throw new ApiError(404, 'NOT_FOUND');
    return { board };
  });
  return boardUpdated(boardId, ctx, result);
}

export async function deleteLabel(boardId, labelId, ctx) {
  const { revision } = await mutateBoard(boardId, async (session) => {
    const res = await Board.updateOne({ _id: boardId, 'labels._id': oid(labelId) },
      { $pull: { labels: { _id: oid(labelId) } } }, { session });
    if (!res.modifiedCount) throw new ApiError(404, 'NOT_FOUND');
    await Card.updateMany({ boardId, labelIds: oid(labelId) }, { $pull: { labelIds: oid(labelId) } }, { session });
    return {};
  });
  publish(boardId, EVT.LABEL_DELETED, { labelId: String(labelId), ...meta(ctx, revision) });
  return { labelId: String(labelId), revision };
}
