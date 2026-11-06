import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { newUser, newBoard, addMember, revisionOf, newId } from './helpers.js';
import { Board } from '../src/models/Board.js';
import { List } from '../src/models/List.js';
import { Card } from '../src/models/Card.js';
import { Comment } from '../src/models/Comment.js';
import { mutateBoard } from '../src/services/mutateBoard.js';
import { sweepOrphans } from '../src/services/orphanSweep.js';
import { comparePos } from '@syncboard/shared/position';

let owner, snap, boardId, list;

beforeEach(async () => {
  owner = await newUser('Owner');
  snap = await newBoard(owner);
  boardId = snap.board._id;
  list = snap.lists[0];
});

const addCard = (title = 'Card', extra = {}) =>
  owner.agent.post(`/api/lists/${list._id}/cards`).send({ title, ...extra });

describe('boards', () => {
  it('basic template: 3 ordered lists, 6 default labels, creator is owner', async () => {
    expect(snap.lists.map((l) => l.title)).toEqual(['To Do', 'Doing', 'Done']);
    expect(snap.board.labels).toHaveLength(6);
    expect(snap.board.members).toEqual([expect.objectContaining({ userId: owner.user._id, role: 'owner', name: 'Owner' })]);
    expect(snap.myRole).toBe('owner');
    expect(snap.revision).toBe(0);
  });

  it('empty template has no lists', async () => {
    const empty = await newBoard(owner, { template: 'empty' });
    expect(empty.lists).toEqual([]);
  });

  it('GET /boards lists only boards I belong to', async () => {
    const other = await newUser('Other');
    await newBoard(other, { title: 'Theirs' });
    const res = await owner.agent.get('/api/boards').expect(200);
    expect(res.body.data.boards.map((b) => b.title)).toEqual(['Board']);
    expect(res.body.data.boards[0].myRole).toBe('owner');
  });

  it('rename bumps the revision by exactly one and echoes clientMutationId', async () => {
    const res = await owner.agent.patch(`/api/boards/${boardId}`).send({ title: 'Renamed', clientMutationId: 'm1' }).expect(200);
    expect(res.body.data).toMatchObject({ board: { title: 'Renamed' }, revision: 1, clientMutationId: 'm1' });
    expect(await revisionOf(boardId)).toBe(1);
  });

  it('delete cascades to lists, cards, and comments', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    await Comment.create({ cardId: card._id, boardId, authorId: owner.user._id, body: 'hi' });
    await owner.agent.delete(`/api/boards/${boardId}`).expect(200);
    expect(await Board.exists({ _id: boardId })).toBeNull();
    expect(await List.countDocuments({ boardId })).toBe(0);
    expect(await Card.countDocuments({ boardId })).toBe(0);
    expect(await Comment.countDocuments({ boardId })).toBe(0);
    await owner.agent.get(`/api/boards/${boardId}`).expect(404);
  });

  it('a large board (>1,000 cards) deletes its children after the commit', async () => {
    await Card.insertMany(Array.from({ length: 1001 }, (_, i) => ({
      boardId, listId: list._id, title: `c${i}`, position: `a${String(i).padStart(4, '0')}`,
    })));
    await owner.agent.delete(`/api/boards/${boardId}`).expect(200);
    expect(await Board.exists({ _id: boardId })).toBeNull();
    expect(await Card.countDocuments({ boardId })).toBe(0);
  });
});

describe('lists', () => {
  it('appends new lists to the end, in order', async () => {
    await owner.agent.post(`/api/boards/${boardId}/lists`).send({ title: 'Later' }).expect(201);
    const lists = await List.find({ boardId }).lean();
    expect(lists.sort(comparePos).map((l) => l.title)).toEqual(['To Do', 'Doing', 'Done', 'Later']);
  });

  it('archive hides the list; restore appends it to the end', async () => {
    await owner.agent.patch(`/api/lists/${list._id}`).send({ archived: true }).expect(200);
    let s = (await owner.agent.get(`/api/boards/${boardId}`)).body.data;
    expect(s.lists.map((l) => l.title)).toEqual(['Doing', 'Done']);
    await owner.agent.patch(`/api/lists/${list._id}`).send({ archived: false }).expect(200);
    s = (await owner.agent.get(`/api/boards/${boardId}`)).body.data;
    expect(s.lists.map((l) => l.title)).toEqual(['Doing', 'Done', 'To Do']);
  });

  it('delete cascades to its cards and their comments, with one revision', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    await Comment.create({ cardId: card._id, boardId, authorId: owner.user._id, body: 'x' });
    const before = await revisionOf(boardId);
    const res = await owner.agent.delete(`/api/lists/${list._id}`).expect(200);
    expect(res.body.data.revision).toBe(before + 1);
    expect(await Card.exists({ _id: card._id })).toBeNull();
    expect(await Comment.countDocuments({ cardId: card._id })).toBe(0);
  });

  it('limit: 100 lists per board → 422', async () => {
    await List.insertMany(Array.from({ length: 97 }, (_, i) => ({ boardId, title: `l${i}`, position: `b${i}` })));
    const res = await owner.agent.post(`/api/boards/${boardId}/lists`).send({ title: 'one too many' }).expect(422);
    expect(res.body.error.code).toBe('LIMIT_REACHED');
  });
});

describe('cards: create', () => {
  it('appends to the end of the list', async () => {
    for (const t of ['a', 'b', 'c']) await addCard(t).expect(201);
    const s = (await owner.agent.get(`/api/boards/${boardId}`)).body.data;
    expect(s.cards.filter((c) => c.listId === list._id).map((c) => c.title)).toEqual(['a', 'b', 'c']);
  });

  it('a repeated create with the same client _id → 200 with the same card, no new revision', async () => {
    const _id = newId();
    const first = await addCard('Once', { _id }).expect(201);
    const rev = await revisionOf(boardId);
    const again = await addCard('Once', { _id }).expect(200);
    expect(again.body.data.card._id).toBe(_id);
    expect(first.body.data.card._id).toBe(_id);
    expect(await revisionOf(boardId)).toBe(rev);
    expect(await Card.countDocuments({ _id })).toBe(1);
  });

  it('someone else reusing that _id → 409, and the card is not returned', async () => {
    const _id = newId();
    await addCard('Mine', { _id }).expect(201);
    const editor = await newUser('Editor');
    await addMember(boardId, editor.user._id, 'editor');
    const res = await editor.agent.post(`/api/lists/${list._id}/cards`).send({ _id, title: 'Theirs' }).expect(409);
    expect(res.body.error.details).toBeUndefined();
  });

  it('two concurrent creates with the same _id → one card', async () => {
    const _id = newId();
    const results = await Promise.all([addCard('Dup', { _id }), addCard('Dup', { _id })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await Card.countDocuments({ _id })).toBe(1);
  });

  it('into an archived list → 404', async () => {
    await owner.agent.patch(`/api/lists/${list._id}`).send({ archived: true }).expect(200);
    await addCard().expect(404);
  });
});

describe('cards: content (compare-and-set)', () => {
  it('stale version → 409 with the current card', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    await owner.agent.patch(`/api/cards/${card._id}/content`).send({ title: 'A', version: 0 }).expect(200);
    const res = await owner.agent.patch(`/api/cards/${card._id}/content`).send({ title: 'B', version: 0 }).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details.current).toMatchObject({ title: 'A', version: 1 });
  });

  it('two concurrent saves with the same version → one 200, one 409', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    const send = (description) => owner.agent.patch(`/api/cards/${card._id}/content`).send({ description, version: 0 });
    const statuses = (await Promise.all([send('one'), send('two')])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
  });

  it('completed / dueDate do not bump version (no false conflicts)', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    await owner.agent.patch(`/api/cards/${card._id}`).send({ completed: true }).expect(200);
    const res = await owner.agent.patch(`/api/cards/${card._id}`).send({ dueDate: '2026-12-01T09:00:00.000Z' }).expect(200);
    expect(res.body.data.card).toMatchObject({ completed: true, version: 0, dueDate: '2026-12-01T09:00:00.000Z' });
    await owner.agent.patch(`/api/cards/${card._id}/content`).send({ description: 'still fine', version: 0 }).expect(200);
    const cleared = await owner.agent.patch(`/api/cards/${card._id}`).send({ dueDate: null }).expect(200);
    expect(cleared.body.data.card.dueDate).toBeNull();
  });
});

describe('cards: assignees and labels', () => {
  it('assigns members only; add is idempotent; remove works', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    const stranger = await newUser('Stranger');
    const bad = await owner.agent.post(`/api/cards/${card._id}/assignees`).send({ userId: stranger.user._id }).expect(400);
    expect(bad.body.error.message).toBe('Not a board member');
    await owner.agent.post(`/api/cards/${card._id}/assignees`).send({ userId: owner.user._id }).expect(200);
    const twice = await owner.agent.post(`/api/cards/${card._id}/assignees`).send({ userId: owner.user._id }).expect(200);
    expect(twice.body.data.card.assigneeIds).toEqual([owner.user._id]);
    const removed = await owner.agent.delete(`/api/cards/${card._id}/assignees/${owner.user._id}`).expect(200);
    expect(removed.body.data.card.assigneeIds).toEqual([]);
  });

  it("only this board's labels can be added", async () => {
    const card = (await addCard().expect(201)).body.data.card;
    await owner.agent.post(`/api/cards/${card._id}/labels`).send({ labelId: newId() }).expect(400);
    const labelId = snap.board.labels[0]._id;
    const res = await owner.agent.post(`/api/cards/${card._id}/labels`).send({ labelId }).expect(200);
    expect(res.body.data.card.labelIds).toEqual([labelId]);
    const removed = await owner.agent.delete(`/api/cards/${card._id}/labels/${labelId}`).expect(200);
    expect(removed.body.data.card.labelIds).toEqual([]);
  });
});

describe('cards: archive, restore, delete', () => {
  it('restore appends the card to the end of its list', async () => {
    const a = (await addCard('a').expect(201)).body.data.card;
    await addCard('b').expect(201);
    await owner.agent.patch(`/api/cards/${a._id}`).send({ archived: true }).expect(200);
    await owner.agent.patch(`/api/cards/${a._id}`).send({ archived: false }).expect(200);
    const s = (await owner.agent.get(`/api/boards/${boardId}`)).body.data;
    expect(s.cards.filter((c) => c.listId === list._id).map((c) => c.title)).toEqual(['b', 'a']);
  });

  it('restore into an archived list → 422 "Restore the list first"', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    await owner.agent.patch(`/api/cards/${card._id}`).send({ archived: true }).expect(200);
    await owner.agent.patch(`/api/lists/${list._id}`).send({ archived: true }).expect(200);
    const res = await owner.agent.patch(`/api/cards/${card._id}`).send({ archived: false }).expect(422);
    expect(res.body.error).toMatchObject({ code: 'LIST_ARCHIVED', message: 'Restore the list first' });
  });

  it('GET /cards/:id returns the card and its first comments page', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    await Comment.create({ cardId: card._id, boardId, authorId: owner.user._id, body: 'hello' });
    const res = await owner.agent.get(`/api/cards/${card._id}`).expect(200);
    expect(res.body.data).toMatchObject({ card: { _id: card._id }, comments: [{ body: 'hello' }], nextCursor: null });
  });

  it('delete removes the card and its comments', async () => {
    const card = (await addCard().expect(201)).body.data.card;
    await Comment.create({ cardId: card._id, boardId, authorId: owner.user._id, body: 'x' });
    const res = await owner.agent.delete(`/api/cards/${card._id}?clientMutationId=m9`).expect(200);
    expect(res.body.data).toMatchObject({ cardId: card._id, listId: list._id, clientMutationId: 'm9' });
    expect(await Comment.countDocuments({ cardId: card._id })).toBe(0);
    await owner.agent.get(`/api/cards/${card._id}`).expect(404);
  });
});

describe('mutateBoard', () => {
  it('a failure inside work() → no data change AND no revision increment', async () => {
    const before = await revisionOf(boardId);
    await expect(mutateBoard(boardId, async (session) => {
      await List.create([{ boardId, title: 'ghost', position: 'zz' }], { session });
      throw new Error('forced');
    })).rejects.toThrow('forced');
    expect(await revisionOf(boardId)).toBe(before);
    expect(await List.exists({ title: 'ghost' })).toBeNull();
  });

  it('a missing board → 404 before any work runs', async () => {
    let ran = false;
    await expect(mutateBoard(newId(), async () => { ran = true; })).rejects.toMatchObject({ status: 404 });
    expect(ran).toBe(false);
  });

  it('20 parallel mutations → revisions are exactly 1..20, no duplicates', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => addCard(`p${i}`)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const revisions = results.map((r) => r.body.data.revision).sort((a, b) => a - b);
    expect(revisions).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await revisionOf(boardId)).toBe(20);
  });
});

describe('orphan sweep', () => {
  it('removes children of boards that no longer exist, and nothing else', async () => {
    const ghostBoard = new mongoose.Types.ObjectId();
    const ghostList = await List.create({ boardId: ghostBoard, title: 'orphan', position: 'a0' });
    await Card.create({ boardId: ghostBoard, listId: ghostList._id, title: 'orphan', position: 'a0' });
    await Comment.create({ boardId: ghostBoard, cardId: new mongoose.Types.ObjectId(), authorId: owner.user._id, body: 'x' });
    const keep = (await addCard('keep').expect(201)).body.data.card;

    expect(await sweepOrphans()).toBeGreaterThanOrEqual(1);
    expect(await List.countDocuments({ boardId: ghostBoard })).toBe(0);
    expect(await Card.countDocuments({ boardId: ghostBoard })).toBe(0);
    expect(await Comment.countDocuments({ boardId: ghostBoard })).toBe(0);
    expect(await Card.exists({ _id: keep._id })).not.toBeNull();
  });
});
