import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { Board } from '../src/models/Board.js';

export const app = createApp();

let seq = 0;

/** Registers a fresh user and returns a cookie-carrying agent. */
export async function newUser(name = 'User') {
  const agent = request.agent(app);
  const email = `${name.toLowerCase()}-${++seq}-${Date.now()}@test.io`;
  const res = await agent.post('/api/auth/register').send({ name, email, password: 'password123' }).expect(201);
  return { agent, user: res.body.data.user };
}

/** Creates a board through the API as `owner` and returns its snapshot. */
export async function newBoard(owner, { template = 'basic', title = 'Board' } = {}) {
  const created = await owner.agent.post('/api/boards').send({ title, template }).expect(201);
  const snap = await owner.agent.get(`/api/boards/${created.body.data.board._id}`).expect(200);
  return snap.body.data;
}

/** Members API arrives in Phase 6; until then tests add members directly. */
export async function addMember(boardId, userId, role) {
  await Board.updateOne({ _id: boardId }, { $push: { members: { userId, role } } });
}

export async function revisionOf(boardId) {
  return (await Board.findById(boardId, { revision: 1 }).lean()).revision;
}

export const newId = () => new mongoose.Types.ObjectId().toHexString();
