/**
 * Pending-ops engine, pure part (docs/05 — Pending Operations, ADR-011).
 *
 *   displayed = replay(pending ops, on top of the last confirmed state)
 *
 * `applyOp` is used both for the optimistic apply and for every replay, so it must be pure and
 * deterministic. Entities are plain objects; `null` means "doesn't exist (yet)", `'DELETED'`
 * means "confirmed gone".
 */

export const DELETED = 'DELETED';

/**
 * @typedef {{ type: 'create', entity: object }
 *   | { type: 'move', toListId?: string, position: string }
 *   | { type: 'content', fields: object }
 *   | { type: 'fields', set: object }
 *   | { type: 'addTo', key: string, id: string }
 *   | { type: 'pullFrom', key: string, id: string }
 *   | { type: 'upsertItem', key: string, item: { _id: string } }   e.g. board labels
 *   | { type: 'removeItem', key: string, id: string }
 *   | { type: 'delete' }} Op
 */

/**
 * @param {object | null | 'DELETED'} entity
 * @param {Op} op
 * @returns {object | null | 'DELETED'}
 */
export function applyOp(entity, op) {
  if (entity === DELETED) return DELETED;
  if (op.type === 'create') return op.entity;
  if (entity == null) return entity;               // its create failed or hasn't been confirmed: nothing to change
  switch (op.type) {
    case 'move':
      return op.toListId === undefined
        ? { ...entity, position: op.position }      // a list move
        : { ...entity, listId: op.toListId, position: op.position };
    case 'content':  return { ...entity, ...op.fields };
    case 'fields':   return { ...entity, ...op.set };
    case 'addTo':    return { ...entity, [op.key]: [...new Set([...(entity[op.key] ?? []), op.id])] };
    case 'pullFrom': return { ...entity, [op.key]: (entity[op.key] ?? []).filter((x) => x !== op.id) };
    case 'upsertItem': {
      const items = entity[op.key] ?? [];
      const i = items.findIndex((x) => x._id === op.item._id);
      return { ...entity, [op.key]: i === -1 ? [...items, op.item] : items.map((x, j) => (j === i ? { ...x, ...op.item } : x)) };
    }
    case 'removeItem': return { ...entity, [op.key]: (entity[op.key] ?? []).filter((x) => x._id !== op.id) };
    case 'delete':   return DELETED;
    default:         return entity;
  }
}

/** Replays `ops` (in order) on top of `base`. */
export const replay = (base, ops) => ops.reduce((e, o) => applyOp(e, o.op), base);

/** True when the value represents a live entity (not null, not deleted). */
export const exists = (e) => e != null && e !== DELETED;
