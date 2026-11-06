import { describe, it, expect, beforeEach } from 'vitest';
import { newUser, newBoard, revisionOf, newId } from './helpers.js';
import { Card } from '../src/models/Card.js';
import { List } from '../src/models/List.js';
import { comparePos, MAX_KEY_LEN } from '@syncboard/shared/position';

/** Move semantics (docs/03, ADR-014): successor-based neighbors, stale tolerance, rebalance. */
let owner, boardId, todo, doing, done;

beforeEach(async () => {
  owner = await newUser('Owner');
  const snap = await newBoard(owner);
  boardId = snap.board._id;
  [todo, doing, done] = snap.lists;
});

const addCard = async (list, title) =>
  (await owner.agent.post(`/api/lists/${list._id}/cards`).send({ title }).expect(201)).body.data.card;
const addCards = async (list, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await addCard(list, `${list.title} ${i}`));
  return out;
};
const moveCard = (card, body) => owner.agent.patch(`/api/cards/${card._id}/move`).send(body);
const moveList = (list, body) => owner.agent.patch(`/api/lists/${list._id}/move`).send(body);

/** Titles of a list's non-archived cards in server order (position, _id). */
async function titles(list) {
  const cards = await Card.find({ listId: list._id, archived: false }).sort({ position: 1, _id: 1 }).lean();
  return cards.map((c) => c.title);
}

describe('PATCH /cards/:id/move', () => {
  it('moves within a list: one revision, echoes clientMutationId, reports fromListId', async () => {
    const [a, b, c] = await addCards(todo, 3);
    const rev = await revisionOf(boardId);
    const res = await moveCard(a, { toListId: todo._id, beforeId: b._id, afterId: c._id, clientMutationId: 'm1' }).expect(200);
    expect(res.body.data).toMatchObject({ revision: rev + 1, clientMutationId: 'm1', fromListId: todo._id });
    expect(await titles(todo)).toEqual(['To Do 1', 'To Do 0', 'To Do 2']);
  });

  it('moves across lists: to the start, the end, and an empty list', async () => {
    const [a, b] = await addCards(todo, 2);
    const [x] = await addCards(doing, 1);
    await moveCard(a, { toListId: doing._id, beforeId: null, afterId: x._id }).expect(200);
    await moveCard(b, { toListId: doing._id, beforeId: x._id, afterId: null }).expect(200);
    expect(await titles(doing)).toEqual(['To Do 0', 'Doing 0', 'To Do 1']);
    expect(await titles(todo)).toEqual([]);
    const res = await moveCard(x, { toListId: done._id }).expect(200);
    expect(res.body.data.card.listId).toBe(done._id);
    expect(res.body.data.fromListId).toBe(doing._id);
  });

  it('a stale before (moved to another list) → placed relative to after', async () => {
    const [, b, c, d] = await addCards(todo, 4);
    await moveCard(b, { toListId: doing._id }).expect(200);      // a teammate moved b away mid-drag
    await moveCard(d, { toListId: todo._id, beforeId: b._id, afterId: c._id }).expect(200);
    expect(await titles(todo)).toEqual(['To Do 0', 'To Do 3', 'To Do 2']);
  });

  it('a stale after (deleted) → placed directly after before', async () => {
    const [a, b, , d] = await addCards(todo, 4);
    await owner.agent.delete(`/api/cards/${b._id}`).expect(200);
    await moveCard(d, { toListId: todo._id, beforeId: a._id, afterId: b._id }).expect(200);
    expect(await titles(todo)).toEqual(['To Do 0', 'To Do 3', 'To Do 2']);
  });

  it('both neighbors stale (archived) → appended to the end', async () => {
    const [a, b] = await addCards(todo, 3);
    await owner.agent.patch(`/api/cards/${a._id}`).send({ archived: true }).expect(200);
    await owner.agent.patch(`/api/cards/${b._id}`).send({ archived: true }).expect(200);
    const [x] = await addCards(doing, 1);
    await moveCard(x, { toListId: todo._id, beforeId: a._id, afterId: b._id }).expect(200);
    expect(await titles(todo)).toEqual(['To Do 2', 'Doing 0']);
  });

  it("the upper bound is before's CURRENT successor, not the client's afterId", async () => {
    const [a, , c] = await addCards(todo, 3);
    const [x] = await addCards(doing, 1);
    // The client claims after = c, but b sits between a and c. The card must land right after a.
    await moveCard(x, { toListId: todo._id, beforeId: a._id, afterId: c._id }).expect(200);
    expect(await titles(todo)).toEqual(['To Do 0', 'Doing 0', 'To Do 1', 'To Do 2']);
  });

  it('a neighbor on another board → 400 and nothing changes', async () => {
    const [a] = await addCards(todo, 1);
    const other = await newBoard(owner, { title: 'Other' });
    const foreign = (await owner.agent.post(`/api/lists/${other.lists[0]._id}/cards`).send({ title: 'F' }).expect(201)).body.data.card;
    const rev = await revisionOf(boardId);
    const res = await moveCard(a, { toListId: doing._id, beforeId: foreign._id }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await revisionOf(boardId)).toBe(rev);
    expect(String((await Card.findById(a._id).lean()).listId)).toBe(todo._id);
  });

  it('target list missing, archived, or on another board → 404', async () => {
    const [a] = await addCards(todo, 1);
    await moveCard(a, { toListId: newId() }).expect(404);
    await owner.agent.patch(`/api/lists/${done._id}`).send({ archived: true }).expect(200);
    await moveCard(a, { toListId: done._id }).expect(404);
    const other = await newBoard(owner, { title: 'Other' });
    await moveCard(a, { toListId: other.lists[0]._id }).expect(404);
  });

  it('an archived card cannot be moved → 404', async () => {
    const [a] = await addCards(todo, 1);
    await owner.agent.patch(`/api/cards/${a._id}`).send({ archived: true }).expect(200);
    await moveCard(a, { toListId: doing._id }).expect(404);
  });

  it('rebalances in the same transaction when keys get too long, and returns the new positions', async () => {
    const [a, b] = await addCards(todo, 2);
    // Simulate a long history of inserts at one spot: the gap between a and b needs a key over the limit.
    const long = 'a0' + 'V'.repeat(MAX_KEY_LEN);
    await Card.updateOne({ _id: a._id }, { $set: { position: long } });
    await Card.updateOne({ _id: b._id }, { $set: { position: `${long}V` } });
    const [x] = await addCards(doing, 1);
    const rev = await revisionOf(boardId);
    const res = await moveCard(x, { toListId: todo._id, beforeId: a._id, afterId: b._id }).expect(200);
    const { card, rebalanced, revision } = res.body.data;
    expect(revision).toBe(rev + 1);                             // still one mutation → one revision
    expect(rebalanced.listId).toBe(todo._id);
    expect(Object.keys(rebalanced.positions).sort()).toEqual([a._id, b._id].sort());
    expect(card.position.length).toBeLessThanOrEqual(MAX_KEY_LEN);
    expect(await titles(todo)).toEqual(['To Do 0', 'Doing 0', 'To Do 1']);
    const stored = (await Card.find({ listId: todo._id }).lean()).filter((c) => String(c._id) !== x._id);
    for (const c of stored) expect(c.position).toBe(rebalanced.positions[String(c._id)]);
  });

  it('two parallel drops into the same gap → distinct keys, both between the neighbors', async () => {
    const [a, b] = await addCards(todo, 2);
    const [x, y] = await addCards(doing, 2);
    const results = await Promise.all([
      moveCard(x, { toListId: todo._id, beforeId: a._id, afterId: b._id }),
      moveCard(y, { toListId: todo._id, beforeId: a._id, afterId: b._id }),
    ]);
    for (const r of results) expect(r.status).toBe(200);
    const [px, py] = results.map((r) => r.body.data.card.position);
    expect(px).not.toBe(py);
    const order = await titles(todo);
    expect(order[0]).toBe('To Do 0');
    expect(order.at(-1)).toBe('To Do 1');
    expect(new Set(order.slice(1, 3))).toEqual(new Set(['Doing 0', 'Doing 1']));
  });

  it('the board snapshot order matches comparePos on the client', async () => {
    const cards = await addCards(todo, 5);
    await moveCard(cards[4], { toListId: todo._id, beforeId: null, afterId: cards[0]._id }).expect(200);
    await moveCard(cards[2], { toListId: todo._id, beforeId: cards[4]._id, afterId: cards[0]._id }).expect(200);
    const snap = (await owner.agent.get(`/api/boards/${boardId}`).expect(200)).body.data;
    const inTodo = snap.cards.filter((c) => c.listId === todo._id);
    expect([...inTodo].sort(comparePos).map((c) => c._id)).toEqual(inTodo.map((c) => c._id));
    expect(await titles(todo)).toEqual(['To Do 4', 'To Do 2', 'To Do 0', 'To Do 1', 'To Do 3']);
  });
});

describe('PATCH /lists/:id/move', () => {
  it('reorders columns with one revision', async () => {
    const rev = await revisionOf(boardId);
    const res = await moveList(done, { beforeId: null, afterId: todo._id, clientMutationId: 'L1' }).expect(200);
    expect(res.body.data).toMatchObject({ revision: rev + 1, clientMutationId: 'L1' });
    const lists = await List.find({ boardId }).sort({ position: 1, _id: 1 }).lean();
    expect(lists.map((l) => l.title)).toEqual(['Done', 'To Do', 'Doing']);
  });

  it('stale neighbor → append; foreign neighbor → 400; archived list → 404', async () => {
    await owner.agent.patch(`/api/lists/${doing._id}`).send({ archived: true }).expect(200);
    await moveList(todo, { beforeId: doing._id }).expect(200);
    const lists = await List.find({ boardId, archived: false }).sort({ position: 1, _id: 1 }).lean();
    expect(lists.map((l) => l.title)).toEqual(['Done', 'To Do']);
    const other = await newBoard(owner, { title: 'Other' });
    await moveList(todo, { afterId: other.lists[0]._id }).expect(400);
    await moveList(doing, {}).expect(404);
  });

  it('two parallel drops into the same gap → distinct keys', async () => {
    const extra = (await owner.agent.post(`/api/boards/${boardId}/lists`).send({ title: 'Extra' }).expect(201)).body.data.list;
    const results = await Promise.all([
      moveList(done, { beforeId: todo._id, afterId: doing._id }),
      moveList(extra, { beforeId: todo._id, afterId: doing._id }),
    ]);
    for (const r of results) expect(r.status).toBe(200);
    expect(results[0].body.data.list.position).not.toBe(results[1].body.data.list.position);
    const lists = await List.find({ boardId }).sort({ position: 1, _id: 1 }).lean();
    expect(lists[0].title).toBe('To Do');
    expect(lists.at(-1).title).toBe('Doing');
  });
});
