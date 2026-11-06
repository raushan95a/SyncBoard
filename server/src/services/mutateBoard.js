import mongoose from 'mongoose';
import { Board } from '../models/Board.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * The mutation unit of work (docs/02, ADR-010, ADR-015).
 *
 * In ONE transaction:
 *   1. $inc board.revision  — FIRST, so concurrent mutations on this board conflict
 *      immediately and are serialized (withTransaction retries the loser).
 *   2. work(session)        — the data writes. Every query must pass { session }.
 *
 * `work` may run more than once on retry, so it must only do database writes:
 * no publish(), no external calls. The caller publishes AFTER this returns.
 *
 * @template T
 * @param {import('mongoose').Types.ObjectId | string} boardId
 * @param {(session: import('mongoose').ClientSession, ctx: { revision: number }) => Promise<T>} work
 * @returns {Promise<T & { revision: number }>}
 */
export async function mutateBoard(boardId, work) {
  const session = await mongoose.startSession();
  let result;
  let revision;
  try {
    await session.withTransaction(async () => {
      const board = await Board.findByIdAndUpdate(
        boardId,
        { $inc: { revision: 1 } },
        { returnDocument: 'after', session, projection: { revision: 1 } },
      );
      if (!board) throw new ApiError(404, 'NOT_FOUND');
      revision = board.revision;
      result = await work(session, { revision });
    });
  } finally {
    await session.endSession();
  }
  return { ...result, revision };
}

/** Runs `work` in a transaction without touching any board revision (board create/delete). */
export async function inTransaction(work) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
  } finally {
    await session.endSession();
  }
  return result;
}
