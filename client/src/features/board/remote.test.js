import { describe, it, expect, beforeEach } from 'vitest';
import { EVT } from '@syncboard/shared/events';
import { seed } from '@syncboard/shared/position';
import reducer, { boardLoading, boardLoaded, remoteEvent, opStarted, opAcked, opFailed } from './boardSlice.js';

/** Remote event reducer (docs/04 — Event Catalog, ADR-011, ADR-016). */

const [p1, p2, p3, p4] = seed(4);
const BOARD = 'b0';
const L1 = 'l1';
const L2 = 'l2';
const ME = 'u-me';
const BOB = 'u-bob';
const LABEL = 'lab1';
const card = (id, listId, position, extra = {}) => ({
  _id: id, boardId: BOARD, listId, title: id, description: '', position, version: 0,
  assigneeIds: [], labelIds: [], dueDate: null, completed: false, archived: false, commentCount: 0, ...extra,
});
const list = (id, position, extra = {}) => ({ _id: id, boardId: BOARD, title: id, position, archived: false, ...extra });

let state;
let rev;
const run = (...actions) => { for (const a of actions) state = reducer(state, a); };
const start = (mid, kind, entityId, op) => opStarted({ mid, kind, entityId, op });
/** Next revisioned event (the pipeline guarantees order; tests just count up). */
const evt = (type, payload) => remoteEvent({ type, payload: { revision: ++rev, actorId: BOB, ...payload }, myUserId: ME });

beforeEach(() => {
  state = undefined;
  rev = 10;
  run(boardLoading(BOARD), boardLoaded({ boardId: BOARD, snapshot: {
    board: {
      _id: BOARD, title: 'B',
      labels: [{ _id: LABEL, name: 'Bug', color: 'red' }],
      members: [{ userId: ME, role: 'editor', name: 'Me' }, { userId: BOB, role: 'editor', name: 'Bob' }],
    },
    lists: [list(L1, p1), list(L2, p2)],
    cards: [
      card('a', L1, p1, { labelIds: [LABEL], assigneeIds: [BOB] }),
      card('b', L1, p2),
      card('c', L1, p3),
      card('x', L2, p1),
    ],
    revision: rev, myRole: 'editor',
  } }));
});

describe('applying events', () => {
  it('advances the revision with every event', () => {
    run(evt(EVT.CARD_UPDATED, { card: card('b', L1, p2, { title: 'B!' }) }));
    expect(state.revision).toBe(11);
    expect(state.cards.byId.b.title).toBe('B!');
  });

  it("a teammate's move with no pending ops is applied directly", () => {
    run(evt(EVT.CARD_MOVED, { card: card('a', L2, p4, { labelIds: [LABEL], assigneeIds: [BOB] }), fromListId: L1 }));
    expect(state.cardIdsByList[L1]).toEqual(['b', 'c']);
    expect(state.cardIdsByList[L2]).toEqual(['x', 'a']);
  });

  it('card:created in a list this client does not have (archived) is skipped', () => {
    run(evt(EVT.CARD_CREATED, { card: card('n', 'archived-list', p1) }));
    expect(state.cards.byId.n).toBeUndefined();
    expect(state.revision).toBe(11);
  });

  it('list:deleted removes the list and all of its cards', () => {
    run(evt(EVT.LIST_DELETED, { listId: L1 }));
    expect(state.lists.order).toEqual([L2]);
    expect(Object.keys(state.cards.byId)).toEqual(['x']);
  });

  it('list:updated restoring a list this client never loaded → asks for a resync', () => {
    run(evt(EVT.LIST_UPDATED, { list: list('restored', p4) }));
    expect(state.needsResync).toBe(true);
  });

  it('card archived by a teammate disappears from its column', () => {
    run(evt(EVT.CARD_UPDATED, { card: card('b', L1, p2, { archived: true }) }));
    expect(state.cardIdsByList[L1]).toEqual(['a', 'c']);
  });

  it('board:updated merges title and labels into the meta', () => {
    run(evt(EVT.BOARD_UPDATED, { board: { _id: BOARD, title: 'Renamed', labels: [] } }));
    expect(state.meta).toMatchObject({ title: 'Renamed', labels: [] });
    expect(state.meta.members).toHaveLength(2);
  });

  it('member:updated for me changes my role; member:removed for me ends the board', () => {
    run(evt(EVT.MEMBER_UPDATED, { member: { userId: ME, role: 'viewer' } }));
    expect(state.myRole).toBe('viewer');
    run(evt(EVT.MEMBER_REMOVED, { userId: ME }));
    expect(state).toMatchObject({ status: 'gone', gone: { reason: 'removed' } });
  });
});

describe('own echo and rebase (ADR-011)', () => {
  it('the echo (matching clientMutationId) confirms the op and clears the base', () => {
    run(start('m1', 'card', 'a', { type: 'move', toListId: L2, position: p4 }), opAcked({ mid: 'm1', revision: 11 }));
    run(evt(EVT.CARD_MOVED, { card: card('a', L2, p4, { labelIds: [LABEL], assigneeIds: [BOB] }), fromListId: L1, clientMutationId: 'm1', actorId: ME }));
    expect(state.ops).toEqual([]);
    expect(state.bases).toEqual({});
    expect(state.cardIdsByList[L2]).toEqual(['x', 'a']);
  });

  it('echo before the REST response: the op is confirmed, the late ack is a no-op', () => {
    run(start('m1', 'card', 'b', { type: 'fields', set: { completed: true } }));
    run(evt(EVT.CARD_UPDATED, { card: card('b', L1, p2, { completed: true }), clientMutationId: 'm1' }));
    run(opAcked({ mid: 'm1', revision: 11 }));
    expect(state.ops).toEqual([]);
    expect(state.cards.byId.b.completed).toBe(true);
  });

  it("a teammate's description edit during my move: their text, my position", () => {
    run(start('m1', 'card', 'b', { type: 'move', toListId: L2, position: p4 }));
    run(evt(EVT.CARD_UPDATED, { card: card('b', L1, p2, { description: 'from Bob', version: 1 }) }));
    expect(state.cards.byId.b).toMatchObject({ description: 'from Bob', listId: L2, position: p4 });
    run(opFailed({ mid: 'm1' }));         // my move fails → back to the CONFIRMED state, which has Bob's text
    expect(state.cards.byId.b).toMatchObject({ description: 'from Bob', listId: L1, position: p2 });
  });

  it('the REST response was lost but the change committed: the echo still lands', () => {
    run(start('m1', 'card', 'b', { type: 'fields', set: { completed: true } }), opFailed({ mid: 'm1' }));
    expect(state.cards.byId.b.completed).toBe(false);
    run(evt(EVT.CARD_UPDATED, { card: card('b', L1, p2, { completed: true }), clientMutationId: 'm1' }));
    expect(state.cards.byId.b.completed).toBe(true);
  });

  it('a delete by a teammate wins over my pending edit; the edit then fails harmlessly', () => {
    run(start('m1', 'card', 'b', { type: 'fields', set: { completed: true } }));
    run(evt(EVT.CARD_DELETED, { cardId: 'b', listId: L1 }));
    expect(state.cards.byId.b).toBeUndefined();
    run(opFailed({ mid: 'm1' }));
    expect(state.cards.byId.b).toBeUndefined();
    expect(state.bases).toEqual({});
  });
});

/**
 * ADR-016: a card has a pending op; an INDIRECT change arrives; then the op is echoed OR fails.
 * In every case the indirect change must survive.
 */
describe('indirect changes reach the confirmed base (ADR-016)', () => {
  const pending = () => run(start('f', 'card', 'a', { type: 'fields', set: { completed: true } }));
  const echo = () => run(evt(EVT.CARD_UPDATED, {
    // The server applied the indirect change too, so the echo's card already reflects it.
    card: { ...state.bases.a, completed: true }, clientMutationId: 'f',
  }));
  const fail = () => run(opFailed({ mid: 'f' }));

  for (const [name, settle] of [['echoed', echo], ['failed', fail]]) {
    it(`label:deleted, then the op is ${name} → the label stays gone`, () => {
      pending();
      run(evt(EVT.LABEL_DELETED, { labelId: LABEL }));
      expect(state.cards.byId.a.labelIds).toEqual([]);
      expect(state.meta.labels).toEqual([]);
      settle();
      expect(state.cards.byId.a.labelIds).toEqual([]);
    });

    it(`member:removed, then the op is ${name} → the assignee stays gone`, () => {
      pending();
      run(evt(EVT.MEMBER_REMOVED, { userId: BOB }));
      expect(state.cards.byId.a.assigneeIds).toEqual([]);
      settle();
      expect(state.cards.byId.a.assigneeIds).toEqual([]);
      expect(state.meta.members.map((m) => m.userId)).toEqual([ME]);
    });

    it(`rebalanced, then the op is ${name} → the rebalanced position stays`, () => {
      const [r1, r2, r3] = seed(3).map((k) => `${k}V`);
      pending();
      run(evt(EVT.CARD_MOVED, {
        card: card('x', L1, `${r3}V`), fromListId: L2,
        rebalanced: { listId: L1, positions: { a: r1, b: r2, c: r3 } },
      }));
      expect(state.cards.byId.a.position).toBe(r1);
      settle();
      expect(state.cards.byId.a).toMatchObject({ position: r1, completed: name === 'echoed' });
      expect(state.cardIdsByList[L1]).toEqual(['a', 'b', 'c', 'x']);
    });

    it(`comment count, then the op is ${name} → the count stays`, () => {
      pending();
      run(evt(EVT.COMMENT_CREATED, { comment: { _id: 'k1', cardId: 'a' }, commentCount: 1 }));
      settle();
      expect(state.cards.byId.a.commentCount).toBe(1);
    });
  }
});

describe('label ops on the board entity (F13)', () => {
  it('optimistic create → board:updated echo confirms it; ops and base cleared', () => {
    const item = { _id: 'lab2', name: 'New', color: 'sky' };
    run(start('L1', 'board', BOARD, { type: 'upsertItem', key: 'labels', item }));
    expect(state.meta.labels.map((l) => l._id)).toEqual([LABEL, 'lab2']);
    run(evt(EVT.BOARD_UPDATED, { board: { _id: BOARD, title: 'B', labels: [{ _id: LABEL, name: 'Bug', color: 'red' }, item] }, clientMutationId: 'L1' }));
    expect(state.ops).toEqual([]);
    expect(state.bases).toEqual({});
    expect(state.meta.labels).toHaveLength(2);
  });

  it('optimistic delete → label:deleted echo also strips it from cards', () => {
    run(start('D1', 'board', BOARD, { type: 'removeItem', key: 'labels', id: LABEL }));
    expect(state.meta.labels).toEqual([]);
    expect(state.cards.byId.a.labelIds).toEqual([LABEL]);     // card faces hide it already; cleaned on echo
    run(evt(EVT.LABEL_DELETED, { labelId: LABEL, clientMutationId: 'D1' }));
    expect(state.cards.byId.a.labelIds).toEqual([]);
    expect(state.ops).toEqual([]);
    expect(state.bases).toEqual({});
  });

  it('a failed rename rolls back, keeping a teammate\'s concurrent label change', () => {
    run(start('R1', 'board', BOARD, { type: 'upsertItem', key: 'labels', item: { _id: LABEL, name: 'Mine' } }));
    run(evt(EVT.BOARD_UPDATED, { board: { _id: BOARD, title: 'B', labels: [{ _id: LABEL, name: 'Bug', color: 'pink' }] } }));
    expect(state.meta.labels[0]).toEqual({ _id: LABEL, name: 'Mine', color: 'pink' });
    run(opFailed({ mid: 'R1' }));
    expect(state.meta.labels[0]).toEqual({ _id: LABEL, name: 'Bug', color: 'pink' });
  });
});
