import { current, isDraft } from '@reduxjs/toolkit';
import { comparePos } from '@syncboard/shared/position';
import { DELETED, exists, replay } from './ops.js';

/**
 * State helpers shared by the slice's reducers and remote.js. They all run on an Immer draft of
 * the `board` slice. Entity kinds: 'board' (the meta object), 'list', 'card'. ObjectIds are
 * unique across collections, so `bases` is keyed by id alone.
 */

export const plain = (x) => (isDraft(x) ? current(x) : x);

export function getDisplayed(state, kind, id) {
  if (kind === 'board') return state.meta?._id === id ? state.meta : null;
  return (kind === 'card' ? state.cards.byId : state.lists.byId)[id] ?? null;
}

/** Writes the displayed entity and refreshes the derived orderings it affects. */
export function setDisplayed(state, kind, id, next) {
  if (kind === 'board') {
    if (exists(next)) state.meta = next;
    return;
  }
  const table = kind === 'card' ? state.cards.byId : state.lists.byId;
  const prev = table[id];
  if (exists(next)) table[id] = next;
  else delete table[id];

  if (kind === 'list') {
    sortLists(state);
  } else {
    const touched = new Set([prev?.listId, exists(next) ? next.listId : undefined].filter(Boolean));
    for (const listId of touched) sortCards(state, listId);
  }
}

export function sortLists(state) {
  const ids = Object.values(state.lists.byId).filter((l) => !l.archived).sort(comparePos).map((l) => l._id);
  if (!sameIds(state.lists.order, ids)) state.lists.order = ids;
}

export function sortCards(state, listId) {
  const ids = Object.values(state.cards.byId)
    .filter((c) => c.listId === listId && !c.archived).sort(comparePos).map((c) => c._id);
  // Keep the old array (and its reference) when nothing changed, so memoized columns skip rendering.
  if (sameIds(state.cardIdsByList[listId], ids)) return;
  if (ids.length) state.cardIdsByList[listId] = ids;
  else delete state.cardIdsByList[listId];
}

const sameIds = (a, b) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

/** Displayed = replay of the entity's pending ops on top of its base. Drops the base when no ops remain. */
export function recompute(state, kind, id) {
  if (!(id in state.bases)) return;
  const base = plain(state.bases[id]);
  const ops = state.ops.filter((o) => o.entityId === id);
  setDisplayed(state, kind, id, replay(base, plain(ops)));
  if (ops.length === 0) delete state.bases[id];
}

/**
 * A new confirmed value for an entity (echo or remote event). With pending ops it becomes the
 * base and the ops are replayed on top; without, it's applied directly.
 */
export function confirmEntity(state, kind, id, entity) {
  if (id in state.bases) {
    state.bases[id] = entity;
    recompute(state, kind, id);
  } else {
    setDisplayed(state, kind, id, entity);
  }
}

/**
 * An INDIRECT change (rebalanced positions, removed label/assignee, comment count, board meta
 * fields) to an entity the event doesn't carry in full. Always applied to the confirmed base,
 * then replayed; never to the displayed entity alone (ADR-016).
 */
export function patchConfirmed(state, kind, id, fn) {
  if (id in state.bases) {
    const base = plain(state.bases[id]);
    if (exists(base)) state.bases[id] = fn(base);
    recompute(state, kind, id);
  } else {
    const cur = getDisplayed(state, kind, id);
    if (exists(cur)) setDisplayed(state, kind, id, fn(plain(cur)));
  }
}

/** `rebalanced = { listId?, positions }` — applied BEFORE the main change (docs/04). */
export function applyRebalanced(state, kind, rebalanced) {
  for (const [id, position] of Object.entries(rebalanced?.positions ?? {})) {
    patchConfirmed(state, kind, id, (e) => ({ ...e, position }));
  }
}

/** Ids of cards matching `pred` in the displayed state OR in a confirmed base. */
export function cardIdsWhere(state, pred) {
  const ids = new Set(Object.values(state.cards.byId).filter(pred).map((c) => c._id));
  for (const [id, b] of Object.entries(state.bases)) if (exists(b) && b.listId && pred(b)) ids.add(id);
  return ids;
}

/** The cards of a deleted list are gone too (cascade). */
export function dropCardsOfList(state, listId) {
  for (const id of cardIdsWhere(state, (c) => c.listId === listId)) confirmEntity(state, 'card', id, DELETED);
}

/** True if the list is known to this client (displayed, or confirmed under a pending op). */
export const knowsList = (state, listId) => !!state.lists.byId[listId] || exists(state.bases[listId]);
