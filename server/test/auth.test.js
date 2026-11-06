import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';

const app = createApp();
const alice = { name: 'Alice', email: 'Alice@Example.com', password: 'correct horse' };

beforeEach(async () => {
  await mongoose.connection.db.collection('users').deleteMany({});
  await User.syncIndexes();
});

async function registered(user = alice) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send(user).expect(201);
  return agent;
}

describe('register', () => {
  it('creates the user, sets an httpOnly cookie, and never returns the hash', async () => {
    const res = await request(app).post('/api/auth/register').send(alice).expect(201);
    expect(res.body.data.user).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.tokenVersion).toBeUndefined();
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^token=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects a duplicate email (case-insensitive) with EMAIL_TAKEN', async () => {
    await registered();
    const res = await request(app).post('/api/auth/register')
      .send({ ...alice, email: 'ALICE@example.com' }).expect(400);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(res.body.error.details[0].path).toBe('email');
  });

  it('validates input with the shared schema (short password, unknown keys)', async () => {
    const short = await request(app).post('/api/auth/register').send({ ...alice, password: 'short' }).expect(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
    const extra = await request(app).post('/api/auth/register').send({ ...alice, role: 'admin' }).expect(400);
    expect(extra.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('login', () => {
  it('logs in with the right password', async () => {
    await registered();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'alice@example.com', password: alice.password }).expect(200);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.data.user.name).toBe('Alice');
  });

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    await registered();
    const wrong = await request(app).post('/api/auth/login')
      .send({ email: alice.email, password: 'wrong password' }).expect(401);
    const unknown = await request(app).post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever1' }).expect(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.body.error.message).toBe('Invalid email or password');
  });
});

describe('session', () => {
  it('register → me → logout → 401', async () => {
    const agent = await registered();
    await agent.get('/api/auth/me').expect(200);
    await agent.post('/api/auth/logout').send({}).expect(200);
    await agent.get('/api/auth/me').expect(401);
  });

  it('logout everywhere revokes every other session (tokenVersion)', async () => {
    const tab1 = await registered();
    const tab2 = request.agent(app);
    await tab2.post('/api/auth/login').send({ email: alice.email, password: alice.password }).expect(200);

    await tab1.post('/api/auth/logout').send({ everywhere: true }).expect(200);
    await tab2.get('/api/auth/me').expect(401);
  });

  it('a revoked tokenVersion → 401 even though the JWT is still valid', async () => {
    const agent = await registered();
    await User.updateOne({ email: 'alice@example.com' }, { $inc: { tokenVersion: 1 } });
    const res = await agent.get('/api/auth/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a missing or forged cookie', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Cookie', 'token=not.a.jwt').expect(401);
  });

  it('logout succeeds even without a valid session', async () => {
    await request(app).post('/api/auth/logout').send({}).expect(200);
  });

  it('protects every other /api route', async () => {
    await request(app).get('/api/boards').expect(401);
  });
});

describe('CSRF defense', () => {
  it('rejects mutations that are not JSON with 415', async () => {
    const res = await request(app).post('/api/auth/login')
      .type('form').send('email=a@b.c&password=x').expect(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});
