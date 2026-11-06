// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import boardReducer, { boardLoading, boardLoaded } from './boardSlice.js';
import { useCardDraft, AUTOSAVE_MS } from './useCardDraft.js';

/** The modal's autosave loop against a fake server with compare-and-set (docs/05, docs/11 F7). */
const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('../../api/http.js', () => ({ http: { patch, get: vi.fn(), post: vi.fn(), del: vi.fn() } }));

const card0 = {
  _id: 'c1', boardId: 'b', listId: 'l', title: 'Title', description: 'Desc', position: 'a0', version: 3,
  assigneeIds: [], labelIds: [], dueDate: null, completed: false, archived: false, commentCount: 0,
};
let db;
/** Applies a content PATCH with compare-and-set, like the server. */
function serverPatch(path, body) {
  if (body.version !== db.version) {
    const err = Object.assign(new Error('conflict'), { status: 409, code: 'CONFLICT', details: { current: { ...db } } });
    return Promise.reject(err);
  }
  const { version: _v, clientMutationId: _m, ...fields } = body;
  db = { ...db, ...fields, version: db.version + 1 };
  return Promise.resolve({ card: { ...db }, revision: 1 });
}

function setup() {
  const store = configureStore({ reducer: { board: boardReducer, auth: () => ({ user: { _id: 'me' } }) } });
  store.dispatch(boardLoading('b'));
  store.dispatch(boardLoaded({ boardId: 'b', snapshot: {
    board: { _id: 'b', title: 'B', labels: [], members: [] }, lists: [{ _id: 'l', boardId: 'b', title: 'L', position: 'a0', archived: false }],
    cards: [card0], revision: 0, myRole: 'editor',
  } }));
  const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
  return renderHook(() => useCardDraft(card0), { wrapper });
}
const settle = () => act(async () => { await vi.runAllTimersAsync(); });

beforeEach(() => {
  vi.useFakeTimers();
  db = { ...card0 };
  patch.mockReset().mockImplementation(serverPatch);
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useCardDraft', () => {
  it('debounces: several keystrokes → one request with the final text, after 800 ms', async () => {
    const { result } = setup();
    act(() => { result.current.setField('description', 'a'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 100); });
    act(() => { result.current.setField('description', 'ab'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_MS - 1); });
    expect(patch).not.toHaveBeenCalled();
    await settle();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0][1]).toMatchObject({ description: 'ab', version: 3 });
    expect(result.current.base.version).toBe(4);
    expect(result.current.dirty).toEqual([]);
  });

  it('closing the modal flushes the pending draft immediately', async () => {
    const { result, unmount } = setup();
    act(() => { result.current.setField('title', 'New title'); });
    unmount();
    await settle();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(db.title).toBe('New title');
  });

  it('409 on a different field → merged and retried silently, both changes saved, no banner', async () => {
    const { result } = setup();
    db = { ...db, description: 'Bob desc', version: 4 };        // Bob saved the description first
    act(() => { result.current.setField('title', 'My title'); });
    await settle();
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[1][1]).toMatchObject({ title: 'My title', version: 4 });
    expect(db).toMatchObject({ title: 'My title', description: 'Bob desc', version: 5 });
    expect(result.current.conflict).toBeNull();
    expect(result.current.draft).toEqual({ title: 'My title', description: 'Bob desc' });
  });

  it('409 on the same field → banner; nothing overwritten until the user chooses "Keep mine"', async () => {
    const { result } = setup();
    db = { ...db, description: 'Bob desc', version: 4 };
    act(() => { result.current.setField('description', 'My desc'); });
    await settle();
    expect(patch).toHaveBeenCalledTimes(1);
    expect(result.current.conflict).toMatchObject({ fields: ['description'] });
    expect(db.description).toBe('Bob desc');
    act(() => { result.current.resolve.mine(); });
    await settle();
    expect(db).toMatchObject({ description: 'My desc', version: 5 });
    expect(result.current.conflict).toBeNull();
  });

  it('a dirty draft is backed up to sessionStorage and restored when the modal reopens', async () => {
    const first = setup();
    act(() => { first.result.current.setField('description', 'unsaved words'); });
    patch.mockImplementation(() => new Promise(() => {}));     // the save never completes (tab crashed)
    first.unmount();
    const second = setup();
    expect(second.result.current.draft.description).toBe('unsaved words');
    expect(second.result.current.dirty).toEqual(['description']);
  });
});
