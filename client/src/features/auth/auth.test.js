import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { bootstrap, login, logout, loggedOut } from './authSlice.js';
import { http, setUnauthorizedHandler, ApiError } from '../../api/http.js';
import { safeNext } from './guards.jsx';
import { zodFieldErrors, apiFieldErrors } from './formErrors.js';
import { registerSchema } from '@syncboard/shared/schemas';

const user = { _id: 'u1', name: 'Alice', email: 'alice@example.com', avatarColor: '#6366f1' };

function mockFetch(status, body) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: () => Promise.resolve(body),
  });
}

const makeStore = () => configureStore({ reducer: { auth: authReducer } });

afterEach(() => {
  vi.restoreAllMocks();
  setUnauthorizedHandler(() => {});
});

describe('authSlice', () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  it('starts booting, then becomes authenticated when /auth/me succeeds', async () => {
    expect(store.getState().auth.status).toBe('booting');
    mockFetch(200, { data: { user } });
    await store.dispatch(bootstrap());
    expect(store.getState().auth).toEqual({ user, status: 'authenticated' });
  });

  it('becomes anonymous when /auth/me returns 401', async () => {
    mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Not signed in' } });
    await store.dispatch(bootstrap());
    expect(store.getState().auth).toEqual({ user: null, status: 'anonymous' });
  });

  it('keeps the API error (code + field details) on a failed login', async () => {
    mockFetch(401, { error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' } });
    const res = await store.dispatch(login({ email: 'a@b.co', password: 'x' }));
    expect(res.payload).toMatchObject({ status: 401, code: 'UNAUTHENTICATED', message: 'Invalid email or password' });
  });

  it('logs out locally even if the logout request fails', async () => {
    mockFetch(200, { data: { user } });
    await store.dispatch(bootstrap());
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('network down'));
    await store.dispatch(logout());
    expect(store.getState().auth.status).toBe('anonymous');
  });

  it('loggedOut clears the user', () => {
    const s = authReducer({ user, status: 'authenticated' }, loggedOut());
    expect(s).toEqual({ user: null, status: 'anonymous' });
  });
});

describe('http wrapper', () => {
  it('sends JSON with same-origin credentials and unwraps { data }', async () => {
    mockFetch(200, { data: { ok: 1 } });
    await expect(http.post('/things', { a: 1 })).resolves.toEqual({ ok: 1 });
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(url).toBe('/api/things');
    expect(opts.credentials).toBe('same-origin');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe('{"a":1}');
  });

  it('calls the unauthorized handler on 401 from a non-auth route, but not from /auth/*', async () => {
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    mockFetch(401, { error: { code: 'UNAUTHENTICATED' } });
    await expect(http.get('/boards')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalledTimes(1);
    await expect(http.get('/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it('normalizes network failures', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(http.get('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });
});

describe('safeNext (open-redirect guard)', () => {
  it('allows same-site paths only', () => {
    expect(safeNext('/b/123?q=x')).toBe('/b/123?q=x');
    expect(safeNext('//evil.com')).toBe('/boards');
    expect(safeNext('/\\evil.com')).toBe('/boards');
    expect(safeNext('https://evil.com')).toBe('/boards');
    expect(safeNext(null)).toBe('/boards');
  });
});

describe('form errors', () => {
  it('maps shared-schema issues to fields', () => {
    const errs = zodFieldErrors(registerSchema, { name: '', email: 'nope', password: 'short' });
    expect(Object.keys(errs).sort()).toEqual(['email', 'name', 'password']);
  });

  it('maps API field details to fields, else a form error', () => {
    expect(apiFieldErrors({ code: 'EMAIL_TAKEN', message: 'taken', details: [{ in: 'body', path: 'email', message: 'taken' }] }))
      .toEqual({ email: 'taken' });
    expect(apiFieldErrors({ code: 'UNAUTHENTICATED', message: 'Invalid email or password' }))
      .toEqual({ _form: 'Invalid email or password' });
  });
});
