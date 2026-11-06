/**
 * One request in flight per entity (docs/05). HTTP doesn't guarantee request order, so each
 * entity's requests are chained: the next is sent only after the previous one settles, whether
 * it succeeded or failed. This keeps the server's order equal to the user's order, and lets a
 * content save use the version confirmed by the previous save.
 *
 * `keys` may name several entities: a card created in (or moved to) a list that is itself still
 * being created waits for that list too.
 */
const tails = new Map();

/**
 * @template T
 * @param {string | string[]} keys
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function sendSerial(keys, fn) {
  const list = [...new Set([keys].flat().filter(Boolean))];
  const prev = Promise.all(list.map((k) => tails.get(k)).filter(Boolean));
  const run = prev.then(fn, fn);                    // never blocked by an earlier failure
  const settled = run.then(() => {}, () => {});
  for (const k of list) {
    tails.set(k, settled);
    // Forget the chain once it's idle, so the map doesn't grow forever.
    settled.then(() => { if (tails.get(k) === settled) tails.delete(k); });
  }
  return run;
}

/** Test helper. */
export const pendingKeys = () => [...tails.keys()];
