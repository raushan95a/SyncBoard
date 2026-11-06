import { boardRoom, userRoom } from '@syncboard/shared/events';

/**
 * Fan-out helpers (docs/04). Called ONLY by services, ONLY after mutateBoard() returns.
 * Until Phase 4 attaches Socket.io via setIO(), they are no-ops, so services can call
 * them from day one.
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
