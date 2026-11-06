import { EVT, boardRoom, userRoom } from '@syncboard/shared/events';

/**
 * Fan-out helpers (docs/04). Called ONLY by services, ONLY after mutateBoard() returns, never
 * inside a transaction callback (it may run more than once). No-ops until createIO() calls
 * setIO(), so services and REST-only tests work without a socket server.
 */
let io = null;

export const setIO = (instance) => {
  io = instance;
};

export const publish = (boardId, event, payload) => {
  io?.to(boardRoom(String(boardId))).emit(event, payload);
};

export const publishUser = (userId, event, payload) => {
  io?.to(userRoom(String(userId))).emit(event, payload);
};

/** Logout everywhere: tell every tab, then drop all of the user's sockets (docs/04). */
export const revokeUserSockets = (userId) => {
  if (!io) return;
  publishUser(userId, EVT.SESSION_REVOKED, {});
  io.in(userRoom(String(userId))).disconnectSockets(true);
};

/** Member removed (Phase 6): stop the user's sockets receiving this board's events. */
export const evictFromBoard = (userId, boardId) => {
  io?.in(userRoom(String(userId))).socketsLeave(boardRoom(String(boardId)));
};
