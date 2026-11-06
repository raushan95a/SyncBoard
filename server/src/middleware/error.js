import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export function notFound(req, _res, next) {
  next(new ApiError(404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`));
}

/** Last middleware. Express 5 forwards rejected promises here, so no asyncHandler is needed. */
export function errorHandler(err, req, res, _next) {
  let apiErr = err;
  if (!(err instanceof ApiError)) {
    if (err?.type === 'entity.too.large') apiErr = new ApiError(413, 'PAYLOAD_TOO_LARGE');
    else if (err?.type === 'entity.parse.failed') apiErr = new ApiError(400, 'VALIDATION_ERROR', 'Malformed JSON');
    else apiErr = new ApiError(500, 'INTERNAL', 'Something went wrong');
  }

  if (apiErr.status >= 500) req.log?.error({ err }, 'unhandled error');

  const body = { code: apiErr.code, message: apiErr.message };
  if (apiErr.details !== undefined) body.details = apiErr.details;
  if (apiErr.status >= 500 && env.NODE_ENV === 'development') body.stack = err?.stack;   // never in production
  res.status(apiErr.status).json({ error: body });
}
