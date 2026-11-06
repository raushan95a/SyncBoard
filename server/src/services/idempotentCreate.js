import { ApiError } from '../utils/ApiError.js';
import { Board } from '../models/Board.js';

/**
 * Client-generated ids make creates safe to retry (ADR-012):
 * - same _id, same creator, same board → the existing document (200, no new revision)
 * - same _id, anyone else              → 409, and the document is never returned
 *
 * Checked BEFORE mutateBoard so a replay doesn't use up a revision. A concurrent duplicate
 * that slips past this check hits E11000 inside the transaction; the caller then runs this
 * check again via `retryOnDuplicate`.
 */
export async function findReplay(Model, _id, userId, boardId) {
  if (!_id) return null;
  const doc = await Model.findById(_id).lean();
  if (!doc) return null;
  if (String(doc.createdBy) === String(userId) && String(doc.boardId) === String(boardId)) {
    const board = await Board.findById(boardId, { revision: 1 }).lean();
    return { doc, revision: board?.revision ?? 0 };
  }
  throw new ApiError(409, 'CONFLICT', 'That id is already in use');
}

/** Runs `create`; on a duplicate _id, resolves through findReplay instead. */
export async function retryOnDuplicate(create, replay) {
  try {
    return await create();
  } catch (err) {
    if (err?.code === 11000 && err?.keyPattern?._id) {
      const r = await replay();
      if (r) return r;
    }
    throw err;
  }
}
