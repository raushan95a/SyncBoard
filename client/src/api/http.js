/**
 * Fetch wrapper (docs/05 — HTTP Wrapper Rules):
 * - same-origin cookies, JSON in and out, `{ data }` unwrapped
 * - errors normalized to ApiError { status, code, message, details }
 * - 401 on anything except /auth/* → the registered handler logs the user out
 * - 30 s timeout
 */
export class ApiError extends Error {
  constructor({ status, code, message, details }) {
    super(message || 'Something went wrong');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const TIMEOUT_MS = 30_000;
let onUnauthorized = () => {};

/** Called once by the store so this module doesn't import it (no cycle). */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    throw new ApiError({
      status: 0,
      code: timedOut ? 'TIMEOUT' : 'NETWORK',
      message: timedOut ? 'The server took too long to respond' : 'Could not reach the server',
    });
  } finally {
    clearTimeout(timer);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError({
      status: res.status,
      code: json?.error?.code ?? `HTTP_${res.status}`,
      message: json?.error?.message ?? res.statusText,
      details: json?.error?.details,
    });
    if (res.status === 401 && !path.startsWith('/auth/')) onUnauthorized(err);
    throw err;
  }
  return json?.data;
}

export const http = {
  get: (path) => request('GET', path),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

/** Plain-object form of an error, safe to keep in Redux. */
export const serializeError = (err) => ({
  status: err?.status ?? 0,
  code: err?.code ?? 'UNKNOWN',
  message: err?.message ?? 'Something went wrong',
  details: err?.details,
});
