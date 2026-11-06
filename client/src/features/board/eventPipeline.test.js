import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEventPipeline } from './eventPipeline.js';

/** Pipeline unit tests (docs/07 Phase 4). A fake board: revision + list of applied revisions. */
let rev, applied, snapshotRev, fetches, needs;

function make() {
  return createEventPipeline({
    apply: (type, p) => { applied.push(p.revision); rev = p.revision; },
    getRevision: () => rev,
    fetchSnapshot: async () => { fetches++; rev = snapshotRev; return true; },
    needsResync: () => needs,
  });
}
const ev = (revision) => ['card:updated', { revision }];

beforeEach(() => {
  vi.useFakeTimers();
  rev = 5;
  applied = [];
  snapshotRev = 5;
  fetches = 0;
  needs = false;
});
afterEach(() => vi.useRealTimers());

describe('event pipeline', () => {
  it('in order → applied immediately', () => {
    const p = make();
    p.push(...ev(6));
    p.push(...ev(7));
    expect(applied).toEqual([6, 7]);
  });

  it('events 7 then 6 → both applied, in order, with no resync', async () => {
    const p = make();
    p.push(...ev(7));
    expect(applied).toEqual([]);
    p.push(...ev(6));
    expect(applied).toEqual([6, 7]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetches).toBe(0);
  });

  it('a duplicate or old event is ignored', () => {
    const p = make();
    p.push(...ev(6));
    p.push(...ev(6));
    p.push(...ev(3));
    expect(applied).toEqual([6]);
  });

  it('missing 6 → resync after 500 ms; held events newer than the snapshot are then applied', async () => {
    const p = make();
    p.push(...ev(7));
    p.push(...ev(8));
    await vi.advanceTimersByTimeAsync(499);
    expect(fetches).toBe(0);
    snapshotRev = 7;                       // the snapshot already contains 6 and 7
    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();
    expect(fetches).toBe(1);
    expect(applied).toEqual([8]);
    expect(rev).toBe(8);
  });

  it('the gap closing in time cancels the resync', async () => {
    const p = make();
    p.push(...ev(7));
    await vi.advanceTimersByTimeAsync(300);
    p.push(...ev(6));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetches).toBe(0);
    expect(applied).toEqual([6, 7]);
  });

  it('events during a drag are buffered, then applied on drop', () => {
    const p = make();
    p.pause('drag');
    p.push(...ev(7));
    p.push(...ev(6));
    expect(applied).toEqual([]);
    p.resume('drag');
    expect(applied).toEqual([6, 7]);
  });

  it('no gap timer while paused (a long drag never resyncs mid-drag)', async () => {
    const p = make();
    p.pause('drag');
    p.push(...ev(9));
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetches).toBe(0);
  });

  it('load: events buffered while loading; those ≤ the snapshot are dropped on resume', () => {
    const p = make();
    p.pause('load');
    p.push(...ev(6));
    p.push(...ev(8));
    p.push(...ev(7));
    rev = 7;                               // the snapshot arrived at revision 7
    p.resume('load');
    expect(applied).toEqual([8]);
  });

  it('a resync requested during a drag runs when the drag ends', async () => {
    const p = make();
    p.pause('drag');
    await p.resync();
    expect(fetches).toBe(0);
    p.resume('drag');
    await vi.runAllTimersAsync();
    expect(fetches).toBe(1);
  });

  it('only one resync at a time', async () => {
    const p = make();
    const a = p.resync();
    const b = p.resync();
    await Promise.all([a, b]);
    expect(fetches).toBe(1);
  });

  it('a reducer asking for a resync (needsResync) triggers one', async () => {
    const p = make();
    needs = true;
    p.push(...ev(6));
    needs = false;
    await vi.runAllTimersAsync();
    expect(fetches).toBe(1);
  });

  it('dispose drops everything and ignores later events', async () => {
    const p = make();
    p.push(...ev(9));
    p.dispose();
    p.push(...ev(6));
    await vi.advanceTimersByTimeAsync(2000);
    expect(applied).toEqual([]);
    expect(fetches).toBe(0);
  });
});
