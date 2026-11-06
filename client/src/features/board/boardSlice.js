import { createSlice } from '@reduxjs/toolkit';
import { DELETED, exists } from './ops.js';
import {
  plain, getDisplayed, sortLists, sortCards, recompute, confirmEntity, applyRebalanced, dropCardsOfList,
} from './engine.js';
import { applyEvent } from './remote.js';

/**
 * Board state (docs/05 — State Model). `lists`, `cards`, and `meta` are the DISPLAYED state:
 * the confirmed state with pending ops replayed on top. `bases` holds the last CONFIRMED value
 * of every entity that has pending ops, and only while it has them (ADR-011).
 *
 * Only the socket stream advances `revision` (docs/04). REST responses ack ops; echoes confirm them.
 */

/** @typedef {'queued' | 'inflight' | 'acked'} OpStatus */
/** @typedef {{ mid: string, kind: 'board'|'list'|'card', entityId: string, op: import('./ops.js').Op, status: OpStatus, revision?: number, version?: number }} PendingOp */

const initialState = {
  boardId: null,
  status: 'idle',            // 'idle' | 'loading' | 'ready' | 'error' | 'gone'
  gone: null,                // { reason: 'not-found' | 'deleted' | 'removed', by: actor name | null }
  error: null,
  connection: 'reconnecting', // 'online' | 'reconnecting' — drag is disabled unless online
  needsResync: false,
  myRole: null,
  revision: 0,
  meta: null,                // { _id, title, labels, members, ... }
  lists: { byId: {}, order: [] },
  cards: { byId: {} },
  cardIdsByList: {},         // derived cache: listId → card ids sorted by comparePos (non-archived)
  bases: {},
  /** @type {PendingOp[]} */
  ops: [],
  // Advisory collaboration state (F14) — never affects correctness.
  presence: [],              // [{ id, name, avatarColor }] viewing this board, deduplicated
  editing: {},               // cardId → { [userId]: user } currently editing that card
  lastActor: {},             // cardId → actorId of the latest confirmed content change ("changed by X")
};

const boardSlice = createSlice({
  name: 'board',
  initialState,
  reducers: {
    boardLoading(state, { payload: boardId }) {
      if (state.boardId !== boardId) return { ...initialState, boardId, status: 'loading' };
      if (state.status !== 'ready' && state.status !== 'gone') state.status = 'loading';
    },

    boardLoadFailed(state, { payload: { boardId, error } }) {
      if (state.boardId !== boardId || state.status === 'gone') return;
      state.error = error;
      if (error.status === 404) {
        state.status = 'gone';
        state.gone = { reason: 'not-found', by: null };
      } else if (state.status !== 'ready') {
        state.status = 'error';
      }
    },

    /**
     * Snapshot (initial load or resync at revision R). Replace everything, drop acked ops already
     * contained in the snapshot (revision ≤ R), and replay the rest on top of the snapshot.
     */
    boardLoaded(state, { payload: { boardId, snapshot } }) {
      if (state.boardId !== boardId || state.status === 'gone') return;
      const R = snapshot.revision;
      const ops = state.ops.filter((o) => !(o.status === 'acked' && o.revision <= R));

      state.status = 'ready';
      state.error = null;
      state.needsResync = false;
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

    /** One revisioned socket event, in order (the event pipeline guarantees it). */
    remoteEvent(state, { payload: { type, payload, myUserId } }) {
      if (state.status !== 'ready') return;
      applyEvent(state, type, payload, { myUserId });
    },

    /** Terminal states: board deleted, access revoked, or not found on join. */
    boardGone(state, { payload: { boardId, reason, by = null } }) {
      if (state.boardId !== boardId) return;
      state.status = 'gone';
      state.gone = { reason, by };
    },

    connectionChanged(state, { payload }) {
      state.connection = payload;
      if (payload !== 'online') {     // stale while offline; the server re-sends on rejoin
        state.presence = [];
        state.editing = {};
      }
    },

    presenceUpdated(state, { payload }) {
      if (payload.boardId === state.boardId) state.presence = payload.users;
    },

    editingUpdated(state, { payload: { cardId, user, editing } }) {
      const who = { ...(state.editing[cardId] ?? {}) };
      if (editing) who[user.id] = user;
      else delete who[user.id];
      if (Object.keys(who).length) state.editing[cardId] = who;
      else delete state.editing[cardId];
    },

    /** User action: remember the confirmed value (first op only), push the op, apply it. */
    opStarted(state, { payload: { mid, kind, entityId, op } }) {
      if (!(entityId in state.bases)) state.bases[entityId] = plain(getDisplayed(state, kind, entityId));
      state.ops.push({ mid, kind, entityId, op, status: 'queued' });
      recompute(state, kind, entityId);
    },

    /** The request for this op is now on the wire (sendSerial reached it). */
    opSent(state, { payload: { mid } }) {
      const o = state.ops.find((x) => x.mid === mid);
      if (o) o.status = 'inflight';
    },

    /**
     * REST success. The op stays until its echo confirms it (docs/05). `version` is the card's
     * version after this request, so a following content save can send it before the echo lands.
     */
    opAcked(state, { payload: { mid, revision, version } }) {
      const o = state.ops.find((x) => x.mid === mid);
      if (!o) return;                       // the echo was faster than the response
      o.status = 'acked';
      o.revision = revision;
      if (version !== undefined) o.version = version;
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
     * Confirms one op with its server entity outside the event stream (no revision change).
     * Kept for callers without an echo; the socket path uses remoteEvent.
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
  boardLoading, boardLoadFailed, boardLoaded, remoteEvent, boardGone, connectionChanged, presenceUpdated, editingUpdated,
  opStarted, opSent, opAcked, opFailed, opConfirmed, boardLeft,
} = boardSlice.actions;
export default boardSlice.reducer;
