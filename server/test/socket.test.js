import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { EVT } from '@syncboard/shared/events';
import { app, newBoard, addMember } from './helpers.js';
import { createIO } from '../src/sockets/index.js';
import { setIO } from '../src/sockets/publisher.js';

/** Socket integration (docs/04, docs/07 Phase 4). */
let server, io, url;
const open = [];

beforeAll(async () => {
  server = http.createServer(app);
  io = createIO(server, { editingTtlMs: 400 });     // short expiry for the editing tests
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});

afterEach(() => {
  for (const s of open.splice(0)) s.disconnect();
});

afterAll(async () => {
  setIO(null);
  io.close();
  await new Promise((r) => server.close(r));
});

let seq = 0;
/** A registered user: { user, cookie, agent } where agent sends the cookie on every request. */
async function newClient(name) {
  const email = `${name.toLowerCase()}-s${++seq}-${Date.now()}@test.io`;
  const res = await request(url).post('/api/auth/register').send({ name, email, password: 'password123' }).expect(201);
  const cookie = res.headers['set-cookie'][0].split(';')[0];
  const agent = request.agent(url);
  agent.set('Cookie', cookie);
  return { user: res.body.data.user, cookie, agent };
}

function connect(cookie) {
  const s = ioClient(url, { transports: ['websocket'], reconnection: false, extraHeaders: cookie ? { cookie } : {} });
  open.push(s);
  return s;
}
const connected = (s) => new Promise((resolve, reject) => {
  s.once('connect', () => resolve(s));
  s.once('connect_error', reject);
});
const join = (s, boardId) => s.emitWithAck(EVT.BOARD_JOIN, { boardId });
const next = (s, event, ms = 3000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
  s.once(event, (p) => { clearTimeout(t); resolve(p); });
});
/** Collects every payload of `event` on `s`. */
const collect = (s, event) => {
  const got = [];
  s.on(event, (p) => got.push(p));
  return got;
};
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

describe('handshake', () => {
  it('no cookie → rejected with UNAUTHENTICATED', async () => {
    await expect(connected(connect())).rejects.toThrow('UNAUTHENTICATED');
  });

  it('a garbage token → rejected', async () => {
    await expect(connected(connect('token=nope'))).rejects.toThrow('UNAUTHENTICATED');
  });

  it('logout everywhere → session:revoked, disconnect, and the old cookie can no longer connect', async () => {
    const a = await newClient('A');
    const s = await connected(connect(a.cookie));
    const revoked = next(s, EVT.SESSION_REVOKED);
    const dropped = next(s, 'disconnect');
    await a.agent.post('/api/auth/logout').send({ everywhere: true }).expect(200);
    await revoked;
    expect(await dropped).toBe('io server disconnect');
    await expect(connected(connect(a.cookie))).rejects.toThrow('UNAUTHENTICATED');
  });
});

describe('board:join', () => {
  it('invalid id → BAD_REQUEST; non-member or missing board → NOT_FOUND', async () => {
    const a = await newClient('A');
    const b = await newClient('B');
    const board = await newBoard(a);
    const s = await connected(connect(b.cookie));
    expect(await join(s, 'nope')).toEqual({ error: 'BAD_REQUEST' });
    expect(await join(s, board.board._id)).toEqual({ error: 'NOT_FOUND' });
    expect(await join(s, '0'.repeat(24))).toEqual({ error: 'NOT_FOUND' });
  });

  it('a member joins and gets a deduplicated presence list', async () => {
    const a = await newClient('A');
    const board = await newBoard(a);
    const s1 = await connected(connect(a.cookie));
    const s2 = await connected(connect(a.cookie));
    expect(await join(s1, board.board._id)).toEqual({ ok: true });
    const presence = next(s1, EVT.PRESENCE_UPDATE);
    expect(await join(s2, board.board._id)).toEqual({ ok: true });
    const p = await presence;
    expect(p.users).toEqual([expect.objectContaining({ id: a.user._id, name: 'A' })]);
  });

  it('one board per socket: joining another board leaves the first room', async () => {
    const a = await newClient('A');
    const one = await newBoard(a, { title: 'One' });
    const two = await newBoard(a, { title: 'Two' });
    const s = await connected(connect(a.cookie));
    await join(s, one.board._id);
    await join(s, two.board._id);
    const got = collect(s, EVT.BOARD_UPDATED);
    await a.agent.patch(`/api/boards/${one.board._id}`).send({ title: 'One!' }).expect(200);
    await a.agent.patch(`/api/boards/${two.board._id}`).send({ title: 'Two!' }).expect(200);
    await tick();
    expect(got.map((e) => e.board.title)).toEqual(['Two!']);
  });
});

describe('broadcast', () => {
  it("A's move reaches A (with its clientMutationId) and B with the same revision; another board hears nothing", async () => {
    const a = await newClient('A');
    const b = await newClient('B');
    const c = await newClient('C');
    const board = await newBoard(a);
    const other = await newBoard(c);
    await addMember(board.board._id, b.user._id, 'editor');
    const [todo, doing] = board.lists;
    const card = (await a.agent.post(`/api/lists/${todo._id}/cards`).send({ title: 'X' }).expect(201)).body.data.card;

    const sa = await connected(connect(a.cookie));
    const sb = await connected(connect(b.cookie));
    const sc = await connected(connect(c.cookie));
    await join(sa, board.board._id);
    await join(sb, board.board._id);
    await join(sc, other.board._id);
    const heardByC = collect(sc, EVT.CARD_MOVED);

    const evA = next(sa, EVT.CARD_MOVED);
    const evB = next(sb, EVT.CARD_MOVED);
    const res = await a.agent.patch(`/api/cards/${card._id}/move`).send({ toListId: doing._id, clientMutationId: 'mid-1' }).expect(200);
    const [pa, pb] = await Promise.all([evA, evB]);

    expect(pa).toMatchObject({ clientMutationId: 'mid-1', revision: res.body.data.revision, actorId: a.user._id, fromListId: todo._id });
    expect(pa.card).toMatchObject({ _id: card._id, listId: doing._id });
    expect(pb.revision).toBe(pa.revision);
    expect(pb.card).toEqual(pa.card);
    await tick();
    expect(heardByC).toEqual([]);
  });

  it('20 parallel mutations → events carry revisions 1 through 20 exactly', async () => {
    const a = await newClient('A');
    const board = await newBoard(a, { template: 'empty' });
    const s = await connected(connect(a.cookie));
    await join(s, board.board._id);
    const got = collect(s, EVT.LIST_CREATED);
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      a.agent.post(`/api/boards/${board.board._id}/lists`).send({ title: `L${i}` }).expect(201)));
    for (let i = 0; i < 50 && got.length < 20; i++) await tick(50);
    expect(got.map((e) => e.revision).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('an idempotent create replay publishes nothing', async () => {
    const a = await newClient('A');
    const board = await newBoard(a);
    const s = await connected(connect(a.cookie));
    await join(s, board.board._id);
    const got = collect(s, EVT.CARD_CREATED);
    const _id = '6aed9c1634595eb0d7249e6b';
    await a.agent.post(`/api/lists/${board.lists[0]._id}/cards`).send({ _id, title: 'X' }).expect(201);
    await a.agent.post(`/api/lists/${board.lists[0]._id}/cards`).send({ _id, title: 'X' }).expect(200);
    await tick();
    expect(got).toHaveLength(1);
  });

  it('board delete → board:deleted to the room and boards:changed to each member', async () => {
    const a = await newClient('A');
    const b = await newClient('B');
    const board = await newBoard(a);
    await addMember(board.board._id, b.user._id, 'viewer');
    const sa = await connected(connect(a.cookie));
    const sb = await connected(connect(b.cookie));      // B is NOT on the board page
    await join(sa, board.board._id);
    const deleted = next(sa, EVT.BOARD_DELETED);
    const changed = next(sb, EVT.BOARDS_CHANGED);
    await a.agent.delete(`/api/boards/${board.board._id}`).expect(200);
    expect(await deleted).toMatchObject({ boardId: board.board._id, actorName: 'A' });
    expect(await changed).toEqual({ boardId: board.board._id, reason: 'deleted' });
  });
});

describe('card editing indicator', () => {
  async function room() {
    const a = await newClient('A');
    const b = await newClient('B');
    const board = await newBoard(a);
    await addMember(board.board._id, b.user._id, 'editor');
    const sa = await connected(connect(a.cookie));
    const sb = await connected(connect(b.cookie));
    await join(sa, board.board._id);
    await join(sb, board.board._id);
    return { a, b, board, sa, sb, cardId: '6aed9c1634595eb0d7249e6c' };
  }

  it('start → relayed to the others in the room (not back to the sender); stop clears it', async () => {
    const { a, sa, sb, cardId } = await room();
    const own = collect(sa, EVT.CARD_EDITING);
    const on = next(sb, EVT.CARD_EDITING);
    sa.emit(EVT.CARD_EDITING_START, { cardId });
    expect(await on).toEqual({ cardId, editing: true, user: expect.objectContaining({ id: a.user._id, name: 'A' }) });
    const off = next(sb, EVT.CARD_EDITING);
    sa.emit(EVT.CARD_EDITING_STOP, { cardId });
    expect(await off).toMatchObject({ cardId, editing: false });
    await tick();
    expect(own).toEqual([]);
  });

  it('expires without a heartbeat; a heartbeat keeps it alive', async () => {
    const { sa, sb, cardId } = await room();
    const got = collect(sb, EVT.CARD_EDITING);
    sa.emit(EVT.CARD_EDITING_START, { cardId });
    await tick(250);
    sa.emit(EVT.CARD_EDITING_HEARTBEAT, { cardId });
    await tick(250);                                   // 500 ms since start, 250 since the heartbeat
    expect(got.map((e) => e.editing)).toEqual([true]);
    await tick(300);                                   // 550 ms since the heartbeat → expired
    expect(got.map((e) => e.editing)).toEqual([true, false]);
  });

  it('cleared when the editor disconnects; ignored before joining a board', async () => {
    const { sa, sb, cardId } = await room();
    const on = next(sb, EVT.CARD_EDITING);
    sa.emit(EVT.CARD_EDITING_START, { cardId });
    await on;
    const off = next(sb, EVT.CARD_EDITING);
    sa.disconnect();
    expect(await off).toMatchObject({ cardId, editing: false });

    const c = await newClient('C');
    const sc = await connected(connect(c.cookie));
    const heard = collect(sb, EVT.CARD_EDITING);
    sc.emit(EVT.CARD_EDITING_START, { cardId });       // not in any board → dropped
    await tick();
    expect(heard).toEqual([]);
  });
});
