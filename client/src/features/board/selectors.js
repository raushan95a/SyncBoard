/** Board selectors. Components select by id, so a change re-renders only what it touched. */

const EMPTY = Object.freeze([]);

export const selectBoardStatus = (s) => s.board.status;
export const selectBoardError = (s) => s.board.error;
export const selectMeta = (s) => s.board.meta;
export const selectMyRole = (s) => s.board.myRole;
export const selectLabels = (s) => s.board.meta?.labels ?? EMPTY;
export const selectMembers = (s) => s.board.meta?.members ?? EMPTY;
export const selectListOrder = (s) => s.board.lists.order;
export const selectList = (s, id) => s.board.lists.byId[id];
export const selectCard = (s, id) => s.board.cards.byId[id];
/** Visible (rendered) card ids of a list, in display order. Phase 7 adds filters here. */
export const selectCardIds = (s, listId) => s.board.cardIdsByList[listId] ?? EMPTY;
export const selectPendingCount = (s) => s.board.ops.length;
