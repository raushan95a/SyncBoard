// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { seed } from '@syncboard/shared/position';
import boardReducer, {
  boardLoading, boardLoaded, opStarted, presenceUpdated, filtersChanged,
} from './boardSlice.js';
import { ListColumn } from './ListColumn.jsx';
import { NO_FILTERS } from './filters.js';

/**
 * Render-count test (docs/05 — Performance Checklist): moving one card re-renders exactly three
 * components — the source column, the destination column, and the moved card.
 */
const keys = seed(12);
const LISTS = ['L1', 'L2', 'L3'];
const card = (id, listId, i, extra = {}) => ({
  _id: id, boardId: 'b', listId, title: id, description: '', position: keys[i], version: 0,
  assigneeIds: [], labelIds: [], dueDate: null, completed: false, archived: false, commentCount: 0, ...extra,
});

let store;
const AUTH = { user: { _id: 'me', name: 'Me' }, status: 'authenticated' };
function mount() {
  store = configureStore({ reducer: { board: boardReducer, auth: () => AUTH } });
  store.dispatch(boardLoading('b'));
  store.dispatch(boardLoaded({ boardId: 'b', snapshot: {
    board: { _id: 'b', title: 'B', labels: [{ _id: 'red', name: 'Red', color: 'red' }], members: [] },
    lists: LISTS.map((id, i) => ({ _id: id, boardId: 'b', title: id, position: keys[i], archived: false })),
    cards: LISTS.flatMap((l) => [0, 1, 2].map((i) => card(`${l}-c${i}`, l, i))),
    revision: 0, myRole: 'editor',
  } }));
  render(
    <Provider store={store}>
      <MemoryRouter>
        <DragDropContext onDragEnd={() => {}}>
          <Droppable droppableId="board" type="LIST" direction="horizontal">
            {(p) => (
              <div ref={p.innerRef} {...p.droppableProps}>
                {LISTS.map((id, i) => <ListColumn key={id} listId={id} index={i} editable canDrag />)}
                {p.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </MemoryRouter>
    </Provider>,
  );
}
/** Renders since the last reset, by component. */
const counts = () => ({ ...globalThis.__RENDER_COUNTS__ });
const reset = () => { globalThis.__RENDER_COUNTS__ = {}; };

beforeEach(() => {
  reset();
  mount();
  reset();
});
afterEach(() => {
  cleanup();
  delete globalThis.__RENDER_COUNTS__;
});

describe('render counts', () => {
  it('moving a card to another list re-renders exactly 3 components', () => {
    // L1-c2 (last in L1) → end of L2, exactly what moveCard dispatches optimistically.
    act(() => { store.dispatch(opStarted({ mid: 'm', kind: 'card', entityId: 'L1-c2', op: { type: 'move', toListId: 'L2', position: keys[9] } })); });
    expect(counts()).toEqual({ 'ListColumn:L1': 1, 'ListColumn:L2': 1, 'CardItem:L1-c2': 1 });
  });

  it('editing one card re-renders only that card', () => {
    act(() => { store.dispatch(opStarted({ mid: 'f', kind: 'card', entityId: 'L3-c1', op: { type: 'fields', set: { completed: true } } })); });
    expect(counts()).toEqual({ 'CardItem:L3-c1': 1 });
  });

  it('an unrelated store change (presence) re-renders nothing', () => {
    act(() => { store.dispatch(presenceUpdated({ boardId: 'b', users: [{ id: 'u2', name: 'Ann' }] })); });
    expect(counts()).toEqual({});
  });

  it('with a filter active: an unrelated card change re-renders only that card, not the columns', () => {
    const filters = { ...NO_FILTERS, labelIds: ['red'] };
    act(() => { store.dispatch(filtersChanged({ filters, query: '?l=red' })); });
    reset();
    act(() => { store.dispatch(opStarted({ mid: 'f', kind: 'card', entityId: 'L3-c1', op: { type: 'fields', set: { completed: true } } })); });
    expect(counts()).toEqual({});        // L3-c1 doesn't match the filter: it's not even rendered
    act(() => { store.dispatch(opStarted({ mid: 'g', kind: 'card', entityId: 'L2-c0', op: { type: 'addTo', key: 'labelIds', id: 'red' } })); });
    expect(counts()).toEqual({ 'ListColumn:L2': 1, 'CardItem:L2-c0': 1 });   // now it matches → appears
  });
});
