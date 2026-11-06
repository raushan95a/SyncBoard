/**
 * Render counter for the render-count test (docs/05 — Performance). A no-op unless a test sets
 * globalThis.__RENDER_COUNTS__ = {}; then each call increments counts[name].
 */
export function countRender(name) {
  const counts = globalThis.__RENDER_COUNTS__;
  if (counts) counts[name] = (counts[name] ?? 0) + 1;
}
