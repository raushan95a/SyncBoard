import { isActive, matches } from './filters.js';

/** Board selectors. Components select by id, so a change re-renders only what it touched. */

const EMPTY = Object.freeze([]);

export const selectBoardStatus = (s) => s.board.status;
export const selectBoardError = (s) => s.board.error;
export const selectConnection = (s) => s.board.connection;
const NOT_GONE = Object.freeze({ reason: null, by: null });
/** { reason: 'not-found' | 'deleted' | 'removed', by } once the board is gone. */
export const selectGone = (s) => s.board.gone ?? NOT_GONE;
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
export const selectPresence = (s) => s.board.presence;
/** The CONFIRMED card (without my pending ops): what teammates' changes look like. */
export const selectConfirmedCard = (s, id) => (id in s.board.bases ? s.board.bases[id] : s.board.cards.byId[id]);
export const selectLastActor = (s, id) => s.board.lastActor[id];
const NO_EDITORS = Object.freeze({});
export const selectEditors = (s, cardId) => s.board.editing[cardId] ?? NO_EDITORS;
export const selectFilters = (s) => s.board.filters;
export const selectFiltersQuery = (s) => s.board.filtersQuery;

const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Per-list memoized "visible card ids" (docs/05 — Performance). Create ONE per column
 * (useMemo), so each column keeps its own cache. Without active filters it returns the list's
 * own id array (same reference). With filters, it returns the previous array whenever the
 * result is unchanged, so an unrelated store update never re-renders the column.
 */
export function makeSelectVisibleCardIds() {
  let lastIds = null;
  let lastFilters = null;
  let lastCards = [];
  let lastResult = EMPTY;
  return (s, listId) => {
    const ids = selectCardIds(s, listId);
    const f = s.board.filters;
    if (!isActive(f)) return ids;
    const cards = ids.map((id) => s.board.cards.byId[id]);
    if (ids === lastIds && f === lastFilters && cards.every((c, i) => c === lastCards[i])) return lastResult;
    const now = Date.now();
    const result = ids.filter((_, i) => matches(cards[i], f, now));
    lastIds = ids;
    lastFilters = f;
    lastCards = cards;
    if (!sameIds(result, lastResult)) lastResult = result.length ? result : EMPTY;
    return lastResult;
  };
}
