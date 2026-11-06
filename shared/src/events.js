/**
 * Socket.io event names shared by server and client (docs/04 — Event Catalog).
 * A typo here becomes an import error instead of a silent bug (ADR-008).
 */
export const EVT = Object.freeze({
  // Board room — revisioned (carry revision, actorId, clientMutationId?)
  CARD_CREATED: 'card:created',
  CARD_UPDATED: 'card:updated',
  CARD_MOVED: 'card:moved',
  CARD_DELETED: 'card:deleted',
  LIST_CREATED: 'list:created',
  LIST_UPDATED: 'list:updated',
  LIST_MOVED: 'list:moved',
  LIST_DELETED: 'list:deleted',
  BOARD_UPDATED: 'board:updated',
  LABEL_DELETED: 'label:deleted',
  MEMBER_ADDED: 'member:added',
  MEMBER_UPDATED: 'member:updated',
  MEMBER_REMOVED: 'member:removed',
  COMMENT_CREATED: 'comment:created',
  COMMENT_DELETED: 'comment:deleted',

  // Board room — not revisioned
  PRESENCE_UPDATE: 'presence:update',
  CARD_EDITING: 'card:editing',
  BOARD_DELETED: 'board:deleted',

  // User room
  BOARDS_CHANGED: 'boards:changed',
  ACCESS_REVOKED: 'board:access-revoked',
  SESSION_REVOKED: 'session:revoked',

  // Client → server
  BOARD_JOIN: 'board:join',
  BOARD_LEAVE: 'board:leave',
  CARD_EDITING_START: 'card:editing:start',
  CARD_EDITING_HEARTBEAT: 'card:editing:heartbeat',
  CARD_EDITING_STOP: 'card:editing:stop',
});

/** Events that go through the client's ordered revision pipeline. */
export const REVISIONED_EVENTS = Object.freeze([
  EVT.CARD_CREATED, EVT.CARD_UPDATED, EVT.CARD_MOVED, EVT.CARD_DELETED,
  EVT.LIST_CREATED, EVT.LIST_UPDATED, EVT.LIST_MOVED, EVT.LIST_DELETED,
  EVT.BOARD_UPDATED, EVT.LABEL_DELETED,
  EVT.MEMBER_ADDED, EVT.MEMBER_UPDATED, EVT.MEMBER_REMOVED,
  EVT.COMMENT_CREATED, EVT.COMMENT_DELETED,
]);

/** Socket room names. */
export const boardRoom = (boardId) => `board:${boardId}`;
export const userRoom = (userId) => `user:${userId}`;
