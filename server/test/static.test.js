import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

/** Production shape (docs/06): one origin serves the API and the built client. */
let dir;
let app;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'syncboard-public-'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
  app = createApp({ staticDir: dir });
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('single-origin static serving', () => {
  it('serves assets, and index.html for client routes (deep links)', async () => {
    await request(app).get('/app.js').expect(200).expect('content-type', /javascript/);
    const page = await request(app).get('/b/123/c/456?q=bug').expect(200);
    expect(page.text).toContain('id="root"');
    expect(page.headers['cache-control']).toBe('no-cache');
  });

  it('never answers API paths with the SPA', async () => {
    const res = await request(app).get('/api/nope').expect(401);     // behind auth, JSON error
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    await request(app).get('/api/healthz').expect(200).expect('content-type', /json/);
  });

  it('sends security headers (helmet CSP, no x-powered-by)', async () => {
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('without a build, there is no static serving at all', async () => {
    const bare = createApp({ staticDir: path.join(dir, 'missing') });
    await request(bare).get('/b/123').expect(404);
  });
});
