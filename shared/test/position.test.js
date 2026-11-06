import { describe, it, expect } from 'vitest';
import { between, seed, comparePos, needsRebalance, MAX_KEY_LEN } from '../src/position.js';

describe('between', () => {
  it('works on an empty list, at the start, and at the end', () => {
    const a = between(null, null);
    const start = between(null, a);
    const end = between(a, null);
    expect(start < a).toBe(true);
    expect(a < end).toBe(true);
  });

  it('returns a key strictly between two keys', () => {
    const [a, b] = seed(2);
    const m = between(a, b);
    expect(a < m && m < b).toBe(true);
  });

  it('1,000 inserts at the same spot stay sorted, and long keys trigger a rebalance', () => {
    const [lo, hi] = seed(2);
    const keys = [lo, hi];
    let upper = hi;
    for (let i = 0; i < 1000; i++) {
      const k = between(lo, upper);          // always insert right after `lo`
      keys.push(k);
      upper = k;
    }
    const sorted = [...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(new Set(keys).size).toBe(keys.length);
    expect(sorted[0]).toBe(lo);
    expect(sorted.at(-1)).toBe(hi);
    expect(upper.length).toBeGreaterThan(MAX_KEY_LEN);
    expect(needsRebalance({ position: lo }, { position: upper })).toBe(true);
  });

  it('seed(n) returns n strictly increasing keys', () => {
    const keys = seed(50);
    expect(keys).toHaveLength(50);
    for (let i = 1; i < keys.length; i++) expect(keys[i - 1] < keys[i]).toBe(true);
  });
});

describe('comparePos', () => {
  it('orders by position, then _id', () => {
    const items = [
      { position: 'a1', _id: 'b' },
      { position: 'a0', _id: 'z' },
      { position: 'a1', _id: 'a' },
    ];
    expect(items.sort(comparePos).map((x) => x._id)).toEqual(['z', 'a', 'b']);
  });

  it('uses code-unit order, not locale order', () => {
    // localeCompare would put lowercase "a" before uppercase "Z"; binary order does the opposite.
    expect(comparePos({ position: 'Z', _id: '1' }, { position: 'a', _id: '1' })).toBe(-1);
  });
});

describe('needsRebalance', () => {
  it('is false for normal bounds', () => {
    const [a, b] = seed(2);
    expect(needsRebalance({ position: a }, { position: b })).toBe(false);
    expect(needsRebalance(null, null)).toBe(false);
  });

  it('is true when bounds are equal or inverted (defensive)', () => {
    expect(needsRebalance({ position: 'a1' }, { position: 'a1' })).toBe(true);
    expect(needsRebalance({ position: 'a2' }, { position: 'a1' })).toBe(true);
  });
});
