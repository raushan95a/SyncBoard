import { describe, it, expect, beforeEach } from 'vitest';
import { newUser, newBoard, revisionOf, newId } from './helpers.js';
import { Board } from '../src/models/Board.js';
import { Card } from '../src/models/Card.js';
import { Comment } from '../src/models/Comment.js';
import { LIMITS } from '@syncboard/shared/limits';

/** Members, labels, comments, archive (docs/07 Phase 6; docs/11 F9–F13). */
let owner, boardId, todo;

beforeEach(async () => {
  owner = await newUser('Owner');
  const snap = await newBoard(owner);
  boardId = snap.board._id;
  todo = snap.lists[0];
});

const invite = (as, email, role = 'editor') => as.agent.post(`/api/boards/${boardId}/members`).send({ email, role });
const addCard = async (as = owner, title = 'Card') =>
  (await as.agent.post(`/api/lists/${todo._id}/cards`).send({ title }).expect(201)).body.data.card;
async function joined(name, role = 'editor') {
  const u = await newUser(name);
  await invite(owner, u.user.email, role).expect(201);
  return u;
}

describe('members (F12)', () => {
  it('invite by email → 201 with the member; the invitee can open the board', async () => {
    const bob = await newUser('Bob');
    const rev = await revisionOf(boardId);
    const res = await invite(owner, bob.user.email.toUpperCase(), 'viewer').expect(201);   // email is case-insensitive
    expect(res.body.data.member).toEqual({ userId: bob.user._id, role: 'viewer', name: 'Bob', email: bob.user.email, avatarColor: expect.any(String) });
    expect(res.body.data.revision).toBe(rev + 1);
    const snap = await bob.agent.get(`/api/boards/${boardId}`).expect(200);
    expect(snap.body.data.myRole).toBe('viewer');
  });

  it('unknown email → 404 "No account with that email"; already a member → 409; non-owner → 403', async () => {
    const res = await invite(owner, 'nobody@nowhere.io').expect(404);
    expect(res.body.error.message).toBe('No account with that email');
    const bob = await joined('Bob');
    await invite(owner, bob.user.email).expect(409);
    const carl = await newUser('Carl');
    await invite(bob, carl.user.email).expect(403);
  });

  it('change role; the last owner cannot be demoted', async () => {
    const bob = await joined('Bob');
    await owner.agent.patch(`/api/boards/${boardId}/members/${bob.user._id}`).send({ role: 'owner' }).expect(200);
    await owner.agent.patch(`/api/boards/${boardId}/members/${owner.user._id}`).send({ role: 'editor' }).expect(200);
    const last = await bob.agent.patch(`/api/boards/${boardId}/members/${bob.user._id}`).send({ role: 'viewer' }).expect(422);
    expect(last.body.error.code).toBe('LAST_OWNER');
  });

  it('the last owner cannot leave; an editor can leave', async () => {
    const res = await owner.agent.delete(`/api/boards/${boardId}/members/${owner.user._id}`).expect(422);
    expect(res.body.error.code).toBe('LAST_OWNER');
    const bob = await joined('Bob');
    await bob.agent.delete(`/api/boards/${boardId}/members/${bob.user._id}`).expect(200);
    await bob.agent.get(`/api/boards/${boardId}`).expect(404);
  });

  it('a non-owner cannot remove someone else', async () => {
    const bob = await joined('Bob');
    const carl = await joined('Carl', 'viewer');
    await bob.agent.delete(`/api/boards/${boardId}/members/${carl.user._id}`).expect(403);
    await carl.agent.delete(`/api/boards/${boardId}/members/${owner.user._id}`).expect(403);
  });

  it('a removed member loses REST access at once and is unassigned from every card', async () => {
    const bob = await joined('Bob');
    const [c1, c2] = [await addCard(), await addCard()];
    for (const c of [c1, c2]) await owner.agent.post(`/api/cards/${c._id}/assignees`).send({ userId: bob.user._id }).expect(200);
    const rev = await revisionOf(boardId);
    await owner.agent.delete(`/api/boards/${boardId}/members/${bob.user._id}`).expect(200);
    expect(await revisionOf(boardId)).toBe(rev + 1);                     // one mutation, one revision
    await bob.agent.get(`/api/boards/${boardId}`).expect(404);
    await bob.agent.patch(`/api/cards/${c1._id}`).send({ completed: true }).expect(404);
    const cards = await Card.find({ boardId }).lean();
    expect(cards.map((c) => String(c._id)).sort()).toEqual([c1._id, c2._id].sort());
    expect(cards.every((c) => c.assigneeIds.length === 0)).toBe(true);
  });
});

describe('labels (F13)', () => {
  it('create (idempotent with a client _id), rename, recolor', async () => {
    const _id = newId();
    const created = await owner.agent.post(`/api/boards/${boardId}/labels`).send({ _id, name: 'Bug', color: 'red' }).expect(201);
    expect(created.body.data.board.labels.at(-1)).toEqual({ _id, name: 'Bug', color: 'red' });
    await owner.agent.post(`/api/boards/${boardId}/labels`).send({ _id, name: 'Bug', color: 'red' }).expect(201);
    expect((await Board.findById(boardId).lean()).labels.filter((l) => String(l._id) === _id)).toHaveLength(1);

    const upd = await owner.agent.patch(`/api/boards/${boardId}/labels/${_id}`).send({ name: 'Defect', color: 'pink' }).expect(200);
    expect(upd.body.data.board.labels.find((l) => l._id === _id)).toEqual({ _id, name: 'Defect', color: 'pink' });
    await owner.agent.patch(`/api/boards/${boardId}/labels/${newId()}`).send({ name: 'x' }).expect(404);
  });

  it('deleting a label removes it from every card, in one revision', async () => {
    const labelId = (await Board.findById(boardId).lean()).labels[0]._id.toString();
    const cards = [await addCard(), await addCard()];
    for (const c of cards) await owner.agent.post(`/api/cards/${c._id}/labels`).send({ labelId }).expect(200);
    const rev = await revisionOf(boardId);
    await owner.agent.delete(`/api/boards/${boardId}/labels/${labelId}`).expect(200);
    expect(await revisionOf(boardId)).toBe(rev + 1);
    const after = await Card.find({ boardId }).lean();
    expect(after.every((c) => !c.labelIds.map(String).includes(labelId))).toBe(true);
    expect((await Board.findById(boardId).lean()).labels.map((l) => String(l._id))).not.toContain(labelId);
  });

  it('limit: 20 labels per board → 422; viewers cannot manage labels', async () => {
    const have = (await Board.findById(boardId).lean()).labels.length;
    for (let i = have; i < LIMITS.LABELS_PER_BOARD; i++) {
      await owner.agent.post(`/api/boards/${boardId}/labels`).send({ color: 'gray' }).expect(201);
    }
    await owner.agent.post(`/api/boards/${boardId}/labels`).send({ color: 'gray' }).expect(422);
    const vic = await joined('Vic', 'viewer');
    await vic.agent.post(`/api/boards/${boardId}/labels`).send({ color: 'gray' }).expect(403);
  });
});

describe('comments (F11)', () => {
  it('create → count +1 with the author; pagination newest first by cursor', async () => {
    const card = await addCard();
    for (let i = 0; i < 23; i++) {
      const res = await owner.agent.post(`/api/cards/${card._id}/comments`).send({ body: `c${i}` }).expect(201);
      expect(res.body.data.commentCount).toBe(i + 1);
    }
    const p1 = (await owner.agent.get(`/api/cards/${card._id}/comments`).expect(200)).body.data;
    expect(p1.comments).toHaveLength(20);
    expect(p1.comments[0]).toMatchObject({ body: 'c22', author: { name: 'Owner' } });
    const p2 = (await owner.agent.get(`/api/cards/${card._id}/comments?cursor=${p1.nextCursor}`).expect(200)).body.data;
    expect(p2.comments.map((c) => c.body)).toEqual(['c2', 'c1', 'c0']);
    expect(p2.nextCursor).toBeNull();
    const withCard = (await owner.agent.get(`/api/cards/${card._id}`).expect(200)).body.data;
    expect(withCard.comments).toHaveLength(20);
    expect((await Card.findById(card._id).lean()).commentCount).toBe(23);
  });

  it('authors delete their own; owners delete anyone\'s; other editors cannot', async () => {
    const card = await addCard();
    const bob = await joined('Bob');
    const carl = await joined('Carl');
    const mine = (await bob.agent.post(`/api/cards/${card._id}/comments`).send({ body: 'bob' }).expect(201)).body.data.comment;
    const other = (await bob.agent.post(`/api/cards/${card._id}/comments`).send({ body: 'bob 2' }).expect(201)).body.data.comment;
    await carl.agent.delete(`/api/comments/${mine._id}`).expect(403);
    const res = await bob.agent.delete(`/api/comments/${mine._id}`).expect(200);
    expect(res.body.data).toMatchObject({ commentId: mine._id, cardId: card._id, commentCount: 1 });
    await owner.agent.delete(`/api/comments/${other._id}`).expect(200);
    expect((await Card.findById(card._id).lean()).commentCount).toBe(0);
  });

  it('viewers cannot comment; commenting on a deleted card → 404', async () => {
    const card = await addCard();
    const vic = await joined('Vic', 'viewer');
    await vic.agent.post(`/api/cards/${card._id}/comments`).send({ body: 'hi' }).expect(403);
    await vic.agent.get(`/api/cards/${card._id}/comments`).expect(200);
    await owner.agent.delete(`/api/cards/${card._id}`).expect(200);
    await owner.agent.post(`/api/cards/${card._id}/comments`).send({ body: 'late' }).expect(404);
    expect(await Comment.countDocuments({ cardId: card._id })).toBe(0);
  });
});

describe('archive (F9)', () => {
  it('GET /archived lists archived lists and cards, newest first; restore into an archived list → 422', async () => {
    const [a, b] = [await addCard(owner, 'A'), await addCard(owner, 'B')];
    await owner.agent.patch(`/api/cards/${a._id}`).send({ archived: true }).expect(200);
    await owner.agent.patch(`/api/cards/${b._id}`).send({ archived: true }).expect(200);
    await owner.agent.patch(`/api/lists/${todo._id}`).send({ archived: true }).expect(200);
    const res = (await owner.agent.get(`/api/boards/${boardId}/archived`).expect(200)).body.data;
    expect(res.cards.map((c) => c.title)).toEqual(['B', 'A']);
    expect(res.lists.map((l) => l.title)).toEqual(['To Do']);
    const restore = await owner.agent.patch(`/api/cards/${a._id}`).send({ archived: false }).expect(422);
    expect(restore.body.error.message).toBe('Restore the list first');
    await owner.agent.patch(`/api/lists/${todo._id}`).send({ archived: false }).expect(200);
    await owner.agent.patch(`/api/cards/${a._id}`).send({ archived: false }).expect(200);
  });
});
