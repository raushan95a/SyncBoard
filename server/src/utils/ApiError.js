/** An error with an HTTP status and a stable code (docs/03 — Conventions). */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} code      e.g. 'NOT_FOUND', 'CONFLICT'
   * @param {string | object} [messageOrDetails]
   * @param {object} [details]
   */
  constructor(status, code, messageOrDetails, details) {
    const message = typeof messageOrDetails === 'string' ? messageOrDetails : defaultMessage(code);
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = typeof messageOrDetails === 'object' ? messageOrDetails : details;
  }
}

function defaultMessage(code) {
  return {
    VALIDATION_ERROR: 'Invalid input',
    UNAUTHENTICATED: 'Not signed in',
    FORBIDDEN: 'You do not have permission to do that',
    NOT_FOUND: 'Not found',
    CONFLICT: 'Conflict',
    PAYLOAD_TOO_LARGE: 'Request body too large',
    UNSUPPORTED_MEDIA_TYPE: 'Content-Type must be application/json',
    LIMIT_REACHED: 'Limit reached',
    RATE_LIMITED: 'Too many requests',
  }[code] ?? 'Something went wrong';
}
