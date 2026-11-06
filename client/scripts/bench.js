/**
 * Client reducer timings on a large board (docs/07 Phase 7): how long the store work takes for
 * a snapshot load, an optimistic move, and the move's echo, with 5 lists × 500 cards. This is the
 * JS cost per interaction before React renders (rendering is covered by the render-count test).
 *
 *   npm run bench -w client
 */
import { performance } from 'node:perf_hooks';
import { configureStore } from '@reduxjs/toolkit';
import { seed } from '@syncboard/shared/position';
import { EVT } from '@syncboard/shared/events';
import boardReducer, { boardLoading, boardLoaded, opStarted, remoteEvent } from '../src/features/board/boardSlice.js';
import { makeSelectVisibleCardIds } from '../src/features/board/selectors.js';
import { NO_FILTERS } from '../src/features/board/filters.js';
import { filtersChanged } from '../src/features/board/boardSlice.js';

const LISTS = 5;
const CARDS = 500;
const RUNS = 200;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r = (x) => Math.round(x * 100) / 100;

const listKeys = seed(LISTS);
const cardKeys = seed(CARDS);
const lists = listKeys.map((position, i) => ({ _id: `l${i}`, boardId: 'b', title: `L${i}`, position, archived: false }));
const cards = lists.flatMap((l) => cardKeys.map((position, i) => ({
  _id: `${l._id}c${String(i).padStart(4, '0')}`, boardId: 'b', listId: l._id, title: `Card ${i}`, description: '', position,
  version: 0, assigneeIds: [], labelIds: i % 7 ? [] : ['red'], dueDate: null, completed: false, archived: false, commentCount: 0,
})));
const snapshot = { board: { _id: 'b', title: 'B', labels: [], members: [] }, lists, cards, revision: 0, myRole: 'owner' };

const store = configureStore({ reducer: { board: boardReducer }, middleware: (d) => d({ serializableCheck: false, immutableCheck: false }) });
store.dispatch(boardLoading('b'));

const load = [];
for (let i = 0; i < 20; i++) {
  const t = performance.now();
  store.dispatch(boardLoaded({ boardId: 'b', snapshot }));
  load.push(performance.now() - t);
}

const move = [];
const echo = [];
for (let i = 0; i < RUNS; i++) {
  const id = `l0c${String(i).padStart(4, '0')}`;
  const t = performance.now();
  store.dispatch(opStarted({ mid: `m${i}`, kind: 'card', entityId: id, op: { type: 'move', toListId: 'l1', position: `${cardKeys[250]}V${i}` } }));
  move.push(performance.now() - t);
  const card = store.getState().board.cards.byId[id];
  const t2 = performance.now();
  store.dispatch(remoteEvent({ type: EVT.CARD_MOVED, payload: { card, fromListId: 'l0', revision: i + 1, clientMutationId: `m${i}` } }));
  echo.push(performance.now() - t2);
}

store.dispatch(filtersChanged({ filters: { ...NO_FILTERS, labelIds: ['red'] }, query: '?l=red' }));
const filter = [];
for (let i = 0; i < RUNS; i++) {
  const select = makeSelectVisibleCardIds();             // cold cache: full recompute for one column
  const t = performance.now();
  select(store.getState(), 'l2');
  filter.push(performance.now() - t);
}

console.log(JSON.stringify({
  cards: cards.length,
  snapshotLoadMs: r(median(load)),
  optimisticMoveMs: r(median(move)),
  echoConfirmMs: r(median(echo)),
  filterOneColumnMs: r(median(filter)),
}, null, 2));
