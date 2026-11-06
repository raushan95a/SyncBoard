import { ApiError } from '../utils/ApiError.js';

/**
 * Validates body/params/query with Zod schemas and stores the parsed values on
 * `req.valid` (ADR-017). In Express 5, `req.query` is read-only, so nothing is written back.
 * Controllers read input only from `req.valid`.
 *
 * @param {{ body?: import('zod').ZodType, params?: import('zod').ZodType, query?: import('zod').ZodType }} schemas
 */
export const validate = (schemas) => (req, _res, next) => {
  const valid = {};
  const issues = [];
  for (const part of ['params', 'query', 'body']) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part] ?? {});
    if (result.success) valid[part] = result.data;
    else issues.push(...result.error.issues.map((i) => ({ in: part, path: i.path.join('.'), message: i.message })));
  }
  if (issues.length) throw new ApiError(400, 'VALIDATION_ERROR', issues[0].message, issues);
  req.valid = valid;
  next();
};
