import { nanoid } from 'nanoid';
import ObjectId from 'bson-objectid';
import toast from 'react-hot-toast';
import { between } from '@syncboard/shared/position';
import { http } from '../../api/http.js';
import { DELETED, exists } from './ops.js';
import {
  boardLoading, boardLoaded, boardLoadFailed, opStarted, opSent, opAcked, opFailed, opConfirmed,
} from './boardSlice.js';
import { sendSerial } from './sendSerial.js';

/**
 * Every board mutation is an op (docs/05): apply optimistically, send through the per-entity
 * serial queue, then confirm or roll back. Comments (Phase 6) are the only non-optimistic writes.
 */

export function messageFor(error, fallback) {
  switch (error?.code) {
    case 'NOT_FOUND': return 'That item no longer exists';
    case 'FORBIDDEN': return 'You don\'t have permission to do that';
    case 'CONFLICT': return 'Someone else changed this card. Showing their version.';
    case 'LIMIT_REACHED':
    case 'LIST_ARCHIVED': return error.message;
    case 'RATE_LIMITED': return 'Too many requests. Slow down a little.';
    case 'NETWORK':
    case 'TIMEOUT': return error.message;
    default: return fallback || error?.message || 'Something went wrong';
  }
}

/** A key between two (possibly missing) neighbors. Never throws: the server has the final say. */
function safeBetween(a, b) {
  try {
    return between(a ?? null, b ?? null);
  } catch {
    return between(a ?? null, null);
  }
}

const board = (getState) => getState().board;

/**
 * The generic op runner.
 * @param {object} o
 * @param {'board'|'list'|'card'} o.kind
 * @param {string} o.entityId
 * @param {import('./ops.js').Op} o.op
 * @param {(mid: string, getState: () => any) => Promise<any>} o.send  runs when the queue reaches it
 * @param {(res: any) => any} o.confirmed   the confirmed entity from the response ('DELETED' for deletes)
 * @param {string[]} [o.waitFor]            other entities whose queues must drain first
 * @param {string} o.error                  toast text on failure
 */
const runOp = ({ kind, entityId, op, send, confirmed, waitFor = [], error }) => (dispatch, getState) => {
  const mid = nanoid();
  dispatch(opStarted({ mid, kind, entityId, op }));
  return sendSerial([entityId, ...waitFor], () => {
    dispatch(opSent({ mid }));
    return send(mid, getState);
  })
    .then((res) => {
      dispatch(opAcked({ mid, revision: res?.revision }));
      // Phase 3 stand-in for the socket echo (see opConfirmed).
      dispatch(opConfirmed({ mid, entity: confirmed(res), rebalanced: res?.rebalanced }));
      return { ok: true, data: res };
    })
    .catch((err) => {
      dispatch(opFailed({ mid, current: err?.code === 'CONFLICT' ? err.details?.current : undefined }));
      if (err?.status !== 401) toast.error(messageFor(err, error));
      return { ok: false, error: err };
    });
};

// ---- loading -------------------------------------------------------------------------------

export const loadBoard = (boardId) => async (dispatch) => {
  dispatch(boardLoading(boardId));
  try {
    const snapshot = await http.get(`/boards/${boardId}`);
    dispatch(boardLoaded({ boardId, snapshot }));
  } catch (err) {
    dispatch(boardLoadFailed({ boardId, error: { status: err.status, code: err.code, message: err.message } }));
  }
};

// ---- board ---------------------------------------------------------------------------------

export const renameBoard = (title) => (dispatch, getState) => {
  const id = board(getState).meta._id;
  return dispatch(runOp({
    kind: 'board', entityId: id, op: { type: 'fields', set: { title } },
    send: (mid) => http.patch(`/boards/${id}`, { title, clientMutationId: mid }),
    confirmed: (res) => res.board,
    error: 'Could not rename the board',
  }));
};

// ---- lists ---------------------------------------------------------------------------------

export const createList = (title) => (dispatch, getState) => {
  const s = board(getState);
  const _id = new ObjectId().toHexString();
  const last = s.lists.byId[s.lists.order.at(-1)];
  const entity = { _id, boardId: s.boardId, title, position: safeBetween(last?.position, null), archived: false };
  return dispatch(runOp({
    kind: 'list', entityId: _id, op: { type: 'create', entity },
    send: (mid) => http.post(`/boards/${s.boardId}/lists`, { _id, title, clientMutationId: mid }),
    confirmed: (res) => res.list,
    error: 'Could not add the list',
  }));
};

const updateList = (listId, set, error) => runOp({
  kind: 'list', entityId: listId, op: { type: 'fields', set },
  send: (mid) => http.patch(`/lists/${listId}`, { ...set, clientMutationId: mid }),
  confirmed: (res) => res.list,
  error,
});
export const renameList = (listId, title) => updateList(listId, { title }, 'Could not rename the list');
export const archiveList = (listId) => updateList(listId, { archived: true }, 'Could not archive the list');

export const deleteList = (listId) => runOp({
  kind: 'list', entityId: listId, op: { type: 'delete' },
  send: (mid) => http.del(`/lists/${listId}?clientMutationId=${mid}`),
  confirmed: () => DELETED,
  error: 'Could not delete the list',
});

/** beforeId/afterId: the columns left/right of the drop point, as the user saw them. */
export const moveList = ({ listId, beforeId, afterId }) => (dispatch, getState) => {
  const { byId } = board(getState).lists;
  const position = safeBetween(byId[beforeId]?.position, byId[afterId]?.position);
  return dispatch(runOp({
    kind: 'list', entityId: listId, op: { type: 'move', position },
    send: (mid) => http.patch(`/lists/${listId}/move`, { beforeId: beforeId ?? null, afterId: afterId ?? null, clientMutationId: mid }),
    confirmed: (res) => res.list,
    waitFor: [beforeId, afterId].filter(Boolean),
    error: 'Could not move the list',
  }));
};

// ---- cards ---------------------------------------------------------------------------------

export const createCard = (listId, title) => (dispatch, getState) => {
  const s = board(getState);
  const _id = new ObjectId().toHexString();
  const last = s.cards.byId[(s.cardIdsByList[listId] ?? []).at(-1)];
  const entity = {
    _id, boardId: s.boardId, listId, title, description: '', position: safeBetween(last?.position, null),
    version: 0, assigneeIds: [], labelIds: [], dueDate: null, completed: false, archived: false, commentCount: 0,
  };
  return dispatch(runOp({
    kind: 'card', entityId: _id, op: { type: 'create', entity },
    send: (mid) => http.post(`/lists/${listId}/cards`, { _id, title, clientMutationId: mid }),
    confirmed: (res) => res.card,
    waitFor: [listId],                    // the list may itself still be being created
    error: 'Could not add the card',
  }));
};

/** cardIds: the VISIBLE ids of the target list with the dragged card removed (docs/05 — DnD). */
export const moveCard = ({ cardId, toListId, beforeId, afterId }) => (dispatch, getState) => {
  const { byId } = board(getState).cards;
  const position = safeBetween(byId[beforeId]?.position, byId[afterId]?.position);
  return dispatch(runOp({
    kind: 'card', entityId: cardId, op: { type: 'move', toListId, position },
    send: (mid) => http.patch(`/cards/${cardId}/move`, {
      toListId, beforeId: beforeId ?? null, afterId: afterId ?? null, clientMutationId: mid,
    }),
    confirmed: (res) => res.card,
    waitFor: [toListId],
    error: 'Could not move the card',
  }));
};

/**
 * Title/description, compare-and-set. The version is read when the request is SENT, from the
 * confirmed base, so a second save waits for the first and uses the version it produced.
 */
export const saveContent = (cardId, fields) => runOp({
  kind: 'card', entityId: cardId, op: { type: 'content', fields },
  send: (mid, getState) => {
    const s = board(getState);
    const confirmed = cardId in s.bases ? s.bases[cardId] : s.cards.byId[cardId];
    const version = exists(confirmed) ? confirmed.version : 0;
    return http.patch(`/cards/${cardId}/content`, { ...fields, version, clientMutationId: mid });
  },
  confirmed: (res) => res.card,
  error: 'Could not save the card',
});

/** completed / dueDate / archived — last-write-wins. */
export const setCardFields = (cardId, set) => runOp({
  kind: 'card', entityId: cardId, op: { type: 'fields', set },
  send: (mid) => http.patch(`/cards/${cardId}`, { ...set, clientMutationId: mid }),
  confirmed: (res) => res.card,
  error: 'Could not update the card',
});

/** kind: 'labels' | 'assignees'. on = currently set → remove it. */
export const toggleCardRef = (cardId, kind, id, on) => {
  const key = kind === 'labels' ? 'labelIds' : 'assigneeIds';
  const bodyKey = kind === 'labels' ? 'labelId' : 'userId';
  return runOp({
    kind: 'card', entityId: cardId, op: { type: on ? 'pullFrom' : 'addTo', key, id },
    send: (mid) => (on
      ? http.del(`/cards/${cardId}/${kind}/${id}?clientMutationId=${mid}`)
      : http.post(`/cards/${cardId}/${kind}`, { [bodyKey]: id, clientMutationId: mid })),
    confirmed: (res) => res.card,
    error: 'Could not update the card',
  });
};

export const deleteCard = (cardId) => runOp({
  kind: 'card', entityId: cardId, op: { type: 'delete' },
  send: (mid) => http.del(`/cards/${cardId}?clientMutationId=${mid}`),
  confirmed: () => DELETED,
  error: 'Could not delete the card',
});
