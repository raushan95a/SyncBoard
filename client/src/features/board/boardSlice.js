import { createSlice, current, isDraft } from '@reduxjs/toolkit';
import { comparePos } from '@syncboard/shared/position';
import { DELETED, exists, replay } from './ops.js';

/**
 * Board state (docs/05 — State Model). `lists`, `cards`, and `meta` are the DISPLAYED state:
 * the confirmed state with pending ops replayed on top. `bases` holds the last CONFIRMED value
 * of every entity that has pending ops, and only while it has them (ADR-011).
 *
 * Entity kinds: 'board' (the meta object), 'list', 'card'. ObjectIds are unique across
 * collections, so `bases` is keyed by id alone.
 */

/** @typedef {'queued' | 'inflight' | 'acked'} OpStatus */
/** @typedef {{ mid: string, kind: 'board'|'list'|'card', entityId: string, op: import('./ops.js').Op, status: OpStatus, revision?: number }} PendingOp */

const initialState = {
  boardId: null,
  status: 'idle',            // 'idle' | 'loading' | 'ready' | 'error' | 'gone'
  error: null,
  myRole: null,
  revision: 0,
  meta: null,                // { _id, title, labels, members, ... }
  lists: { byId: {}, order: [] },
  cards: { byId: {} },
  cardIdsByList: {},         // derived cache: listId → card ids sorted by comparePos (non-archived)
  bases: {},
  /** @type {PendingOp[]} */
  ops: [],
};

const plain = (x) => (isDraft(x) ? current(x) : x);

// ---- displayed-state accessors -------------------------------------------------------------

function getDisplayed(state, kind, id) {
  if (kind === 'board') return state.meta?._id === id ? state.meta : null;
  return (kind === 'card' ? state.cards.byId : state.lists.byId)[id] ?? null;
}

/** Writes the displayed entity and refreshes the derived orderings it affects. */
function setDisplayed(state, kind, id, next) {
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

function sortLists(state) {
  state.lists.order = Object.values(state.lists.byId)
    .filter((l) => !l.archived).sort(comparePos).map((l) => l._id);
}

function sortCards(state, listId) {
  const ids = Object.values(state.cards.byId)
    .filter((c) => c.listId === listId && !c.archived).sort(comparePos).map((c) => c._id);
  const old = state.cardIdsByList[listId];
  // Keep the old array (and its reference) when nothing changed, so memoized columns skip rendering.
  if (old && old.length === ids.length && old.every((x, i) => x === ids[i])) return;
  if (ids.length) state.cardIdsByList[listId] = ids;
  else delete state.cardIdsByList[listId];
}

/** Displayed = replay of the entity's pending ops on top of its base. Drops the base when no ops remain. */
function recompute(state, kind, id) {
  if (!(id in state.bases)) return;
  const base = plain(state.bases[id]);
  const ops = state.ops.filter((o) => o.entityId === id);
  setDisplayed(state, kind, id, replay(base, plain(ops)));
  if (ops.length === 0) delete state.bases[id];
}

/**
 * A new confirmed value for an entity (echo, remote event, REST confirmation). With pending ops
 * it becomes the base and the ops are replayed on top; without, it's applied directly.
 * Exported for remote.js (Phase 4).
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
 * An INDIRECT change (rebalanced positions, removed label/assignee, comment count) to an entity
 * that the event doesn't carry in full. Always applied to the confirmed base, then replayed;
 * never to the displayed entity alone (ADR-016).
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
  if (!rebalanced) return;
  for (const [id, position] of Object.entries(rebalanced.positions ?? {})) {
    patchConfirmed(state, kind, id, (e) => ({ ...e, position }));
  }
}

/** The cards of a deleted list are gone too (cascade). */
function dropCardsOfList(state, listId) {
  const ids = new Set([
    ...Object.values(state.cards.byId).filter((c) => c.listId === listId).map((c) => c._id),
    ...Object.entries(state.bases).filter(([, b]) => exists(b) && b.listId === listId).map(([id]) => id),
  ]);
  for (const id of ids) confirmEntity(state, 'card', id, DELETED);
}

// ---- slice ---------------------------------------------------------------------------------

const boardSlice = createSlice({
  name: 'board',
  initialState,
  reducers: {
    boardLoading(state, { payload: boardId }) {
      if (state.boardId !== boardId) return { ...initialState, boardId, status: 'loading' };
      state.status = state.status === 'ready' ? 'ready' : 'loading';
    },

    boardLoadFailed(state, { payload: { boardId, error } }) {
      if (state.boardId !== boardId) return;
      state.error = error;
      state.status = error.status === 404 ? 'gone' : state.status === 'ready' ? 'ready' : 'error';
    },

    /**
     * Snapshot (initial load or resync at revision R). Replace everything, drop acked ops already
     * contained in the snapshot (revision ≤ R), and replay the rest on top of the snapshot.
     */
    boardLoaded(state, { payload: { boardId, snapshot } }) {
      if (state.boardId !== boardId) return;
      const R = snapshot.revision;
      const ops = state.ops.filter((o) => !(o.status === 'acked' && o.revision <= R));

      state.status = 'ready';
      state.error = null;
      state.myRole = snapshot.myRole;
      state.revision = R;
      state.meta = snapshot.board;
      state.lists = { byId: Object.fromEntries(snapshot.lists.map((l) => [l._id, l])), order: [] };
      state.cards = { byId: Object.fromEntries(snapshot.cards.map((c) => [c._id, c])) };
      state.cardIdsByList = {};
      state.ops = ops;
      state.bases = {};
      sortLists(state);
      for (const listId of new Set(snapshot.cards.map((c) => c.listId))) sortCards(state, listId);

      for (const o of ops) {
        if (o.entityId in state.bases) continue;
        state.bases[o.entityId] = plain(getDisplayed(state, o.kind, o.entityId));
        recompute(state, o.kind, o.entityId);
      }
    },

    /** User action: remember the confirmed value (first op only), push the op, apply it. */
    opStarted: {
      reducer(state, { payload: { mid, kind, entityId, op } }) {
        if (!(entityId in state.bases)) state.bases[entityId] = plain(getDisplayed(state, kind, entityId));
        state.ops.push({ mid, kind, entityId, op, status: 'queued' });
        recompute(state, kind, entityId);
      },
      prepare: (payload) => ({ payload }),
    },

    /** The request for this op is now on the wire (sendSerial reached it). */
    opSent(state, { payload: { mid } }) {
      const o = state.ops.find((x) => x.mid === mid);
      if (o) o.status = 'inflight';
    },

    /** REST success. The op stays until its echo confirms it (docs/05). */
    opAcked(state, { payload: { mid, revision } }) {
      const o = state.ops.find((x) => x.mid === mid);
      if (!o) return;
      o.status = 'acked';
      o.revision = revision;
    },

    /**
     * REST error: drop the op and replay the rest on the base, so a teammate's confirmed change
     * survives the rollback. On a 409 the server sends the current entity → it becomes the base.
     */
    opFailed(state, { payload: { mid, current: serverCurrent } }) {
      const o = state.ops.find((x) => x.mid === mid);
      if (!o) return;
      state.ops = state.ops.filter((x) => x.mid !== mid);
      if (serverCurrent && o.entityId in state.bases) state.bases[o.entityId] = serverCurrent;
      recompute(state, o.kind, o.entityId);
    },

    /**
     * Own echo: the server's confirmed entity for this op. Base = that entity, the op is removed,
     * the rest replay on top. `entity` may be 'DELETED'. `rebalanced` is applied first.
     *
     * Phase 3 has no sockets yet, so thunks dispatch this with the REST response. Phase 4's
     * socket pipeline dispatches it from the echoed event (matched by clientMutationId) instead.
     */
    opConfirmed(state, { payload: { mid, entity, rebalanced } }) {
      const o = state.ops.find((x) => x.mid === mid);
      if (!o) return;
      if (rebalanced) applyRebalanced(state, o.kind, rebalanced);
      state.ops = state.ops.filter((x) => x.mid !== mid);
      const base = o.kind === 'board' && exists(entity) ? { ...plain(state.bases[o.entityId]), ...entity } : entity;
      confirmEntity(state, o.kind, o.entityId, base);
      if (o.kind === 'list' && entity === DELETED) dropCardsOfList(state, o.entityId);
    },

    boardLeft() {
      return initialState;
    },
  },
});

export const {
  boardLoading, boardLoadFailed, boardLoaded, opStarted, opSent, opAcked, opFailed, opConfirmed, boardLeft,
} = boardSlice.actions;
export default boardSlice.reducer;
