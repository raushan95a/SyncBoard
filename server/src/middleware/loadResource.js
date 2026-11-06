import mongoose from 'mongoose';
import { List } from '../models/List.js';
import { Card } from '../models/Card.js';
import { Board } from '../models/Board.js';
import { Comment } from '../models/Comment.js';
import { ApiError } from '../utils/ApiError.js';
import { RANK } from '@syncboard/shared/roles';

/**
 * Resolve the board from the resource stored in the database, never from the request body
 * (docs/06). Must run AFTER validate(), which guarantees ids are ObjectIds.
 */
export const boardFromParam = (param) => (req, _res, next) => {
  req.boardId = req.valid.params[param];
  next();
};

export async function loadList(req, _res, next) {
  const id = req.valid.params.id ?? req.valid.params.listId;
  const list = await List.findById(id).lean();
  if (!list) throw new ApiError(404, 'NOT_FOUND');
  req.list = list;
  req.boardId = list.boardId;
  next();
}

export async function loadCard(req, _res, next) {
  const card = await Card.findById(req.valid.params.id ?? req.valid.params.cardId).lean();
  if (!card) throw new ApiError(404, 'NOT_FOUND');
  req.card = card;
  req.boardId = card.boardId;
  next();
}

export async function loadComment(req, _res, next) {
  const comment = await Comment.findById(req.valid.params.id).lean();
  if (!comment) throw new ApiError(404, 'NOT_FOUND');
  req.comment = comment;
  req.boardId = comment.boardId;
  next();
}

/** Comments: authors may delete their own; owners may delete any comment (docs/06). */
export function requireCommentDelete(req, _res, next) {
  const own = String(req.comment.authorId) === String(req.user.id);
  if (!own && RANK[req.boardRole] < RANK.owner) throw new ApiError(403, 'FORBIDDEN');
  next();
}

/**
 * Looks up the caller's role on req.boardId. Non-members get 404 (hides whether the
 * board exists); members below `min` get 403. Sets req.boardRole.
 * @param {'viewer' | 'editor' | 'owner'} min
 */
export const requireRole = (min) => async (req, _res, next) => {
  const role = await getRole(req.boardId, req.user.id);
  if (!role) throw new ApiError(404, 'NOT_FOUND');
  if (RANK[role] < RANK[min]) throw new ApiError(403, 'FORBIDDEN');
  req.boardRole = role;
  next();
};

/** The user's role on a board, or null. Pass a session to read inside a transaction. */
export async function getRole(boardId, userId, session) {
  // Projections are not cast by Mongoose, so $elemMatch needs a real ObjectId.
  const uid = new mongoose.Types.ObjectId(String(userId));
  const board = await Board.findOne(
    { _id: boardId, 'members.userId': uid },
    { members: { $elemMatch: { userId: uid } } },
  ).session(session ?? null).lean();
  return board?.members?.[0]?.role ?? null;
}

/**
 * Re-checks membership INSIDE the mutation transaction for destructive operations,
 * so a member removed a moment ago can't slip a delete through (docs/06).
 */
export async function assertRoleInTx(boardId, userId, min, session) {
  const role = await getRole(boardId, userId, session);
  if (!role) throw new ApiError(404, 'NOT_FOUND');
  if (RANK[role] < RANK[min]) throw new ApiError(403, 'FORBIDDEN');
}
