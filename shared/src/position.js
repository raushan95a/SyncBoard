import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** Keys longer than this trigger a rebalance of the list (docs/02). */
export const MAX_KEY_LEN = 50;

/**
 * A key strictly between a and b. Either bound may be null/undefined (start/end).
 * @param {string | null | undefined} a
 * @param {string | null | undefined} b
 * @returns {string}
 */
export const between = (a, b) => generateKeyBetween(a ?? null, b ?? null);

/**
 * n evenly spread keys for an empty range (used by rebalance and templates).
 * @param {number} n
 * @returns {string[]}
 */
export const seed = (n) => generateNKeysBetween(null, null, n);

/**
 * Total order on (position, _id). Plain code-unit comparison — NEVER localeCompare,
 * which would disagree with MongoDB's binary sort.
 * @param {{ position: string, _id: unknown }} x
 * @param {{ position: string, _id: unknown }} y
 * @returns {-1 | 0 | 1}
 */
export const comparePos = (x, y) => {
  if (x.position < y.position) return -1;
  if (x.position > y.position) return 1;
  const xi = String(x._id);
  const yi = String(y._id);
  return xi < yi ? -1 : xi > yi ? 1 : 0;
};

/**
 * True when the list must be rebalanced before placing an item between these bounds.
 * With successor-based resolution (ADR-014) the ordering check should never fire; it stays
 * as a defense against legacy or hand-edited data.
 * @param {{ position: string } | null | undefined} before
 * @param {{ position: string } | null | undefined} after
 */
export const needsRebalance = (before, after) => {
  if (before && after && before.position >= after.position) return true;
  try {
    return between(before?.position, after?.position).length > MAX_KEY_LEN;
  } catch {
    return true;
  }
};
