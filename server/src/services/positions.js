import { between, seed, needsRebalance } from '@syncboard/shared/position';
import { List } from '../models/List.js';
import { Card } from '../models/Card.js';

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
