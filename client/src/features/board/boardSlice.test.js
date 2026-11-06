import { describe, it, expect, beforeEach } from 'vitest';
import { seed } from '@syncboard/shared/position';
import reducer, {
  boardLoading, boardLoaded, opStarted, opSent, opAcked, opFailed, opConfirmed,
} from './boardSlice.js';
import { DELETED } from './ops.js';

/** Pending-ops engine reducer tests (docs/05, docs/07 Phase 3). */

const [p1, p2, p3, p4] = seed(4);
const BOARD = 'b0';
const L1 = 'l1';
const L2 = 'l2';
const card = (id, listId, position, extra = {}) => ({
  _id: id, boardId: BOARD, listId, title: id, description: '', position, version: 0,
  assigneeIds: [], labelIds: [], dueDate: null, completed: false, archived: false, commentCount: 0, ...extra,
});
const snapshot = (cards, revision = 10) => ({
  board: { _id: BOARD, title: 'B', labels: [], members: [] },
  lists: [{ _id: L1, boardId: BOARD, title: 'One', position: p1, archived: false },
    { _id: L2, boardId: BOARD, title: 'Two', position: p2, archived: false }],
  cards, revision, myRole: 'owner',
});

let state;
const run = (...actions) => { for (const a of actions) state = reducer(state, a); };
const start = (mid, kind, entityId, op) => opStarted({ mid, kind, entityId, op });

beforeEach(() => {
  state = undefined;
  run(boardLoading(BOARD), boardLoaded({ boardId: BOARD, snapshot: snapshot([
    card('a', L1, p1), card('b', L1, p2), card('c', L1, p3), card('x', L2, p1),
  ]) }));
});

describe('optimistic apply', () => {
  it('applies immediately, remembers the base once, keeps the op queued', () => {
    run(start('m1', 'card', 'a', { type: 'move', toListId: L2, position: p4 }));
    expect(state.cards.byId.a).toMatchObject({ listId: L2, position: p4 });
    expect(state.cardIdsByList[L1]).toEqual(['b', 'c']);
    expect(state.cardIdsByList[L2]).toEqual(['x', 'a']);
    expect(state.bases.a).toMatchObject({ listId: L1, position: p1 });
    expect(state.ops).toEqual([expect.objectContaining({ mid: 'm1', status: 'queued' })]);
    run(opSent({ mid: 'm1' }), opAcked({ mid: 'm1', revision: 11 }));
    expect(state.ops[0]).toMatchObject({ status: 'acked', revision: 11 });
    expect(state.bases.a).toMatchObject({ listId: L1 });     // ack alone doesn't confirm
  });

  it('untouched lists keep the same id array (memoized columns skip rendering)', () => {
    const before = state.cardIdsByList[L2];
    run(start('m1', 'card', 'b', { type: 'move', toListId: L1, position: p4 }));
    expect(state.cardIdsByList[L1]).toEqual(['a', 'c', 'b']);
    expect(state.cardIdsByList[L2]).toBe(before);
  });
});

describe('two ops on one card (the reason for the rebase model)', () => {
  const toggle = { type: 'fields', set: { completed: true } };
  const move = { type: 'move', toListId: L2, position: p4 };

  it('toggle then move; confirming the toggle does not make the card jump back', () => {
    run(start('t', 'card', 'a', toggle), start('m', 'card', 'a', move));
    expect(state.cards.byId.a).toMatchObject({ completed: true, listId: L2, position: p4 });

    // The server confirms the toggle: the card is completed but (on the server) still in L1.
    run(opAcked({ mid: 't', revision: 11 }),
      opConfirmed({ mid: 't', entity: card('a', L1, p1, { completed: true }) }));
    expect(state.cards.byId.a).toMatchObject({ completed: true, listId: L2, position: p4 });
    expect(state.cardIdsByList[L2]).toEqual(['x', 'a']);
    expect(state.bases.a).toMatchObject({ completed: true, listId: L1 });
  });

  it('fail the second → only it is undone', () => {
    run(start('t', 'card', 'a', toggle), start('m', 'card', 'a', move));
    run(opConfirmed({ mid: 't', entity: card('a', L1, p1, { completed: true }) }));
    run(opFailed({ mid: 'm' }));
    expect(state.cards.byId.a).toMatchObject({ completed: true, listId: L1, position: p1 });
    expect(state.cardIdsByList[L1]).toEqual(['a', 'b', 'c']);
    expect(state.ops).toEqual([]);
    expect(state.bases).toEqual({});                         // no ops left → base dropped
  });

  it('fail the first while the second is pending → only the first is undone', () => {
    run(start('t', 'card', 'a', toggle), start('m', 'card', 'a', move));
    run(opFailed({ mid: 't' }));
    expect(state.cards.byId.a).toMatchObject({ completed: false, listId: L2, position: p4 });
  });

  it('confirm both → displayed equals the last confirmed entity, base cleared', () => {
    run(start('t', 'card', 'a', toggle), start('m', 'card', 'a', move));
    run(opConfirmed({ mid: 't', entity: card('a', L1, p1, { completed: true }) }),
      opConfirmed({ mid: 'm', entity: card('a', L2, p4, { completed: true }) }));
    expect(state.cards.byId.a).toEqual(card('a', L2, p4, { completed: true }));
    expect(state.bases).toEqual({});
  });
});

describe('creates and deletes', () => {
  it('a failed create removes the card, and a later op on it is dropped too', () => {
    run(start('c1', 'card', 'n', { type: 'create', entity: card('n', L1, p4) }),
      start('c2', 'card', 'n', { type: 'fields', set: { completed: true } }));
    expect(state.cardIdsByList[L1]).toEqual(['a', 'b', 'c', 'n']);
    run(opFailed({ mid: 'c1' }));
    expect(state.cards.byId.n).toBeUndefined();
    expect(state.cardIdsByList[L1]).toEqual(['a', 'b', 'c']);
    run(opFailed({ mid: 'c2' }));                             // its request 404s
    expect(state.cards.byId.n).toBeUndefined();
    expect(state.bases).toEqual({});
  });

  it('a confirmed create takes the server entity', () => {
    run(start('c1', 'card', 'n', { type: 'create', entity: card('n', L1, p4) }),
      opConfirmed({ mid: 'c1', entity: card('n', L1, p4, { createdBy: 'u1' }) }));
    expect(state.cards.byId.n.createdBy).toBe('u1');
    expect(state.bases).toEqual({});
  });

  it('a failed delete brings the card back', () => {
    run(start('d', 'card', 'b', { type: 'delete' }));
    expect(state.cards.byId.b).toBeUndefined();
    expect(state.cardIdsByList[L1]).toEqual(['a', 'c']);
    run(opFailed({ mid: 'd' }));
    expect(state.cardIdsByList[L1]).toEqual(['a', 'b', 'c']);
  });

  it('a confirmed list delete removes its cards, including ones with pending ops', () => {
    run(start('f', 'card', 'a', { type: 'fields', set: { completed: true } }),
      start('dl', 'list', L1, { type: 'delete' }));
    expect(state.lists.order).toEqual([L2]);
    run(opConfirmed({ mid: 'dl', entity: DELETED }));
    expect(state.lists.byId[L1]).toBeUndefined();
    expect(Object.keys(state.cards.byId)).toEqual(['x']);
    expect(state.cardIdsByList[L1]).toBeUndefined();
    run(opFailed({ mid: 'f' }));                              // the card's own op later 404s
    expect(state.cards.byId.a).toBeUndefined();
  });

  it('archiving hides a list; failure restores it', () => {
    run(start('ar', 'list', L1, { type: 'fields', set: { archived: true } }));
    expect(state.lists.order).toEqual([L2]);
    run(opFailed({ mid: 'ar' }));
    expect(state.lists.order).toEqual([L1, L2]);
  });
});

describe('server-provided state', () => {
  it('409: the server\'s current card becomes the base, the failed edit is dropped', () => {
    run(start('e', 'card', 'a', { type: 'content', fields: { title: 'mine' } }));
    expect(state.cards.byId.a.title).toBe('mine');
    run(opFailed({ mid: 'e', current: card('a', L1, p1, { title: 'theirs', version: 3 }) }));
    expect(state.cards.byId.a).toMatchObject({ title: 'theirs', version: 3 });
  });

  it('rebalanced positions reach the BASE of a card with a pending op (ADR-016)', () => {
    const [r1, r2, r3, r4] = seed(4).map((k) => `${k}0`);
    run(start('f', 'card', 'b', { type: 'fields', set: { completed: true } }),
      start('m', 'card', 'x', { type: 'move', toListId: L1, position: p4 }));
    run(opConfirmed({
      mid: 'm', entity: card('x', L1, r4),
      rebalanced: { listId: L1, positions: { a: r1, b: r2, c: r3 } },
    }));
    expect(state.cards.byId.a.position).toBe(r1);
    expect(state.bases.b.position).toBe(r2);
    // The pending op on b then fails: b must keep the rebalanced position, not the old one.
    run(opFailed({ mid: 'f' }));
    expect(state.cards.byId.b).toMatchObject({ position: r2, completed: false });
    expect(state.cardIdsByList[L1]).toEqual(['a', 'b', 'c', 'x']);
  });

  it('board rename merges the confirmed meta into the existing one', () => {
    run(start('r', 'board', BOARD, { type: 'fields', set: { title: 'New' } }));
    expect(state.meta.title).toBe('New');
    run(opConfirmed({ mid: 'r', entity: { _id: BOARD, title: 'New', labels: [] } }));
    expect(state.meta).toMatchObject({ title: 'New', members: [] });
  });

  it('resync: acked ops already in the snapshot are dropped; the rest replay on the snapshot', () => {
    run(start('old', 'card', 'a', { type: 'fields', set: { completed: true } }), opAcked({ mid: 'old', revision: 11 }),
      start('new', 'card', 'b', { type: 'fields', set: { completed: true } }));
    run(boardLoaded({ boardId: BOARD, snapshot: snapshot([
      card('a', L1, p1, { completed: true }), card('b', L1, p2, { title: 'renamed by B' }), card('c', L1, p3),
    ], 11) }));
    expect(state.ops.map((o) => o.mid)).toEqual(['new']);
    expect(state.cards.byId.b).toMatchObject({ completed: true, title: 'renamed by B' });
    expect(state.bases.b).toMatchObject({ completed: false, title: 'renamed by B' });
  });

  it('switching boards starts from a clean state', () => {
    run(start('m', 'card', 'a', { type: 'fields', set: { completed: true } }), boardLoading('other'));
    expect(state).toMatchObject({ boardId: 'other', status: 'loading', ops: [], bases: {}, meta: null });
  });
});
