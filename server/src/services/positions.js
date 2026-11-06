import mongoose from 'mongoose';
import { between, seed, needsRebalance } from '@syncboard/shared/position';
import { List } from '../models/List.js';
import { Card } from '../models/Card.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Server-side ordering helpers. All run inside the caller's transaction.
 * Rebalances ride along in the same event as the change that needed them (ADR-003/004).
 */

const ORDER = { position: 1, _id: 1 };
const REVERSE = { position: -1, _id: -1 };

async function rebalance(Model, filter, session) {
  const items = await Model.find(filter).sort(ORDER).select('_id').session(session).lean();
  const keys = seed(items.length);
  if (items.length) {
    await Model.bulkWrite(items.map((it, i) => ({
      updateOne: { filter: { _id: it._id }, update: { $set: { position: keys[i] } } },
    })), { session });
  }
  return Object.fromEntries(items.map((it, i) => [String(it._id), keys[i]]));
}

/** Position for appending to the end of a filter's ordered set, rebalancing first if keys got too long. */
async function appendPosition(Model, filter, session, rebalanceInfo) {
  let last = await Model.findOne(filter).sort(REVERSE).select('position').session(session).lean();
  if (!needsRebalance(last, null)) return { position: between(last?.position, null) };
  const positions = await rebalance(Model, filter, session);
  last = await Model.findOne(filter).sort(REVERSE).select('position').session(session).lean();
  return { position: between(last?.position, null), rebalanced: { ...rebalanceInfo, positions } };
}

/** End of a list's (non-archived) cards. */
export const appendCardPosition = (listId, session) =>
  appendPosition(Card, { listId, archived: false }, session, { listId: String(listId) });

/** End of a board's (non-archived) lists. */
export const appendListPosition = (boardId, session) =>
  appendPosition(List, { boardId, archived: false }, session, {});

/*
 * ---- Moves: successor-based neighbor resolution (docs/02, ADR-014) ----
 *
 * The client's beforeId/afterId describe the list as the user SAW it. The server only trusts
 * `before` as the lower bound and takes the upper bound from the CURRENT list (before's
 * actual successor). Mutations on a board are serialized (ADR-015), so two drops into the
 * same gap get distinct keys: the second sees the first card as before's successor.
 */

const gt = (v) => mongoose.trusted({ $gt: v });
const lt = (v) => mongoose.trusted({ $lt: v });
const ne = (v) => mongoose.trusted({ $ne: v });

/** First item in scope sorting strictly after `ref` (or before it, when `dir` is -1). */
function adjacent(Model, scope, movingId, ref, dir, session) {
  const cmp = dir > 0 ? gt : lt;
  return Model.findOne({
    ...scope,
    _id: ne(movingId),
    $or: [{ position: cmp(ref.position) }, { position: ref.position, _id: cmp(ref._id) }],
  }).sort(dir > 0 ? ORDER : REVERSE).select('_id position').session(session).lean();
}

/**
 * @param {object} o
 * @param {import('mongoose').Model<any>} o.Model
 * @param {object} o.scope           the ordered set, e.g. { listId, archived: false }
 * @param {(doc: any) => boolean} o.inScope  is a looked-up neighbor still part of `scope`?
 * @param {any} o.boardId
 * @param {any} o.movingId
 * @param {string | null | undefined} o.beforeId
 * @param {string | null | undefined} o.afterId
 * @returns {Promise<[any, any]>}  [before, after] — either may be null
 */
async function resolveNeighbors({ Model, scope, inScope, boardId, movingId, beforeId, afterId }, session) {
  const lookup = async (id) => {
    if (!id || String(id) === String(movingId)) return null;
    const doc = await Model.findById(id).select('_id boardId listId archived position').session(session).lean();
    if (!doc) return null;                                    // deleted concurrently → stale, ignore
    if (String(doc.boardId) !== String(boardId)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Neighbor belongs to another board');
    }
    return inScope(doc) ? doc : null;                         // archived or moved away → stale, ignore
  };
  // Sequential on purpose: operations sharing one transaction session must not run in parallel.
  const before = await lookup(beforeId);
  const after = await lookup(afterId);

  if (before) return [before, await adjacent(Model, scope, movingId, before, 1, session)];
  if (after) return [await adjacent(Model, scope, movingId, after, -1, session), after];
  // Neither usable → append to the end.
  const last = await Model.findOne({ ...scope, _id: ne(movingId) })
    .sort(REVERSE).select('_id position').session(session).lean();
  return [last, null];
}

/** Resolve neighbors, rebalancing the scope first if the new key would be too long. */
async function placeMoved(args, rebalanceInfo, session) {
  let [before, after] = await resolveNeighbors(args, session);
  let rebalanced;
  if (needsRebalance(before, after)) {
    const positions = await rebalance(args.Model, args.scope, session);
    rebalanced = { ...rebalanceInfo, positions };
    [before, after] = await resolveNeighbors(args, session);
  }
  return { position: between(before?.position, after?.position), rebalanced };
}

/** New position for card `cardId` in list `toListId`. */
export const placeCard = ({ boardId, cardId, toListId, beforeId, afterId }, session) => placeMoved({
  Model: Card,
  scope: { listId: toListId, archived: false },
  inScope: (d) => String(d.listId) === String(toListId) && !d.archived,
  boardId, movingId: cardId, beforeId, afterId,
}, { listId: String(toListId) }, session);

/** New position for list `listId` among its board's lists. */
export const placeList = ({ boardId, listId, beforeId, afterId }, session) => placeMoved({
  Model: List,
  scope: { boardId, archived: false },
  inScope: (d) => !d.archived,
  boardId, movingId: listId, beforeId, afterId,
}, {}, session);
