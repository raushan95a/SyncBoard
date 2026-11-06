import { ApiError } from '../utils/ApiError.js';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

/**
 * CSRF defense (docs/06): mutations must be JSON. An HTML form can't send this content
 * type, and a cross-origin fetch that sets it triggers a preflight that the server rejects.
 * `req.is()` is null when there's no body, so body-less POSTs are rejected too.
 */
export function requireJson(req, _res, next) {
  if (BODY_METHODS.has(req.method) && !req.is('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  next();
}
