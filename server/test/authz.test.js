import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, newUser, newBoard, addMember, newId } from './helpers.js';
import { Card } from '../src/models/Card.js';

/**
 * Authorization matrix (docs/08): non-member → 404 on everything; viewer → 403 on every
 * mutation; viewer can read; unauthenticated → 401.
 */
let owner, viewer, stranger, board, list, card, label;

beforeAll(async () => {
  owner = await newUser('Owner');
  viewer = await newUser('Viewer');
  stranger = await newUser('Stranger');
  board = await newBoard(owner);
  await addMember(board.board._id, viewer.user._id, 'viewer');
  list = board.lists[0];
  label = board.board.labels[0];
  const res = await owner.agent.post(`/api/lists/${list._id}/cards`).send({ title: 'Card' }).expect(201);
  card = res.body.data.card;
});

const mutations = () => [
  ['PATCH', `/api/boards/${board.board._id}`, { title: 'X' }],
  ['DELETE', `/api/boards/${board.board._id}`],
  ['POST', `/api/boards/${board.board._id}/lists`, { title: 'L' }],
  ['PATCH', `/api/lists/${list._id}`, { title: 'L2' }],
  ['PATCH', `/api/lists/${list._id}/move`, { beforeId: null, afterId: null }],
  ['DELETE', `/api/lists/${list._id}`],
  ['POST', `/api/lists/${list._id}/cards`, { title: 'C' }],
  ['PATCH', `/api/cards/${card._id}/content`, { title: 'T', version: 0 }],
  ['PATCH', `/api/cards/${card._id}`, { completed: true }],
  ['POST', `/api/cards/${card._id}/assignees`, { userId: owner.user._id }],
  ['DELETE', `/api/cards/${card._id}/assignees/${owner.user._id}`],
  ['POST', `/api/cards/${card._id}/labels`, { labelId: label._id }],
  ['DELETE', `/api/cards/${card._id}/labels/${label._id}`],
  ['PATCH', `/api/cards/${card._id}/move`, { toListId: list._id }],
  ['DELETE', `/api/cards/${card._id}`],
];
const reads = () => [
  ['GET', `/api/boards/${board.board._id}`],
  ['GET', `/api/cards/${card._id}`],
];

function call(agent, [method, path, body]) {
  const req = agent[method.toLowerCase()](path);
  return body ? req.send(body) : req;
}

describe('authorization matrix', () => {
  it('non-member → 404 on every board, list, and card route', async () => {
    for (const route of [...mutations(), ...reads()]) {
      const res = await call(stranger.agent, route);
      expect(res.status, `${route[0]} ${route[1]}`).toBe(404);
    }
  });

  it('viewer → 403 on every mutation route', async () => {
    for (const route of mutations()) {
      const res = await call(viewer.agent, route);
      expect(res.status, `${route[0]} ${route[1]}`).toBe(403);
    }
  });

  it('viewer can read the board and cards', async () => {
    for (const route of reads()) {
      const res = await call(viewer.agent, route);
      expect(res.status, `${route[0]} ${route[1]}`).toBe(200);
    }
  });

  it('unauthenticated → 401 everywhere', async () => {
    for (const route of [...mutations(), ...reads()]) {
      const res = await call(request(app), route);
      expect(res.status, `${route[0]} ${route[1]}`).toBe(401);
    }
  });

  it('nothing changed after all those rejected requests', async () => {
    const fresh = await Card.findById(card._id).lean();
    expect(fresh).toMatchObject({ title: 'Card', completed: false, version: 0 });
  });

  it('invalid ids → 400 before any query; unknown ids → 404', async () => {
    await owner.agent.get('/api/cards/not-an-id').expect(400);
    await owner.agent.get(`/api/cards/${newId()}`).expect(404);
  });

  it('an editor cannot rename or delete the board (owner only)', async () => {
    const editor = await newUser('Editor');
    await addMember(board.board._id, editor.user._id, 'editor');
    await editor.agent.patch(`/api/boards/${board.board._id}`).send({ title: 'X' }).expect(403);
    await editor.agent.delete(`/api/boards/${board.board._id}`).expect(403);
  });
});
