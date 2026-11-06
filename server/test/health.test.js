import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('GET /api/healthz', () => {
  it('reports ok with the database up', async () => {
    const res = await request(app).get('/api/healthz').expect(200);
    expect(res.body).toMatchObject({ ok: true, db: 'up' });
    expect(typeof res.body.instance).toBe('string');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('error handling', () => {
  it('returns the standard error shape for unknown routes', async () => {
    const res = await request(app).get('/nope').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 401 (not 404) for unknown /api routes without a session', async () => {
    const res = await request(app).get('/api/nope').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(app).post('/api/healthz')
      .set('Content-Type', 'application/json').send('{bad').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects bodies over 100 kB with 413', async () => {
    const res = await request(app).post('/api/healthz')
      .set('Content-Type', 'application/json').send(JSON.stringify({ x: 'a'.repeat(110_000) })).expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});
