/**
 * Field errors from a shared Zod schema (client-side, before submit).
 * @returns {Record<string, string> | null}
 */
export function zodFieldErrors(schema, values) {
  const result = schema.safeParse(values);
  if (result.success) return null;
  const errors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '_form');
    errors[field] ??= issue.message;
  }
  return errors;
}

/**
 * Field errors from a serialized API error. Errors that point at a body field are shown
 * on that field; anything else becomes a form-level message.
 * @returns {Record<string, string>}
 */
export function apiFieldErrors(err) {
  const errors = {};
  for (const d of err?.details ?? []) {
    if (d?.in === 'body' && d.path) errors[d.path] ??= d.message;
  }
  if (!Object.keys(errors).length) errors._form = err?.message ?? 'Something went wrong';
  return errors;
}
