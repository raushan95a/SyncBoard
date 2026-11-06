/**
 * Ordered delivery of revisioned board events (docs/04 — Client Event Pipeline):
 *
 *   socket ─► [paused? → buffer] ─► [revision check / reorder] ─► apply ─► (rebase happens in the reducer)
 *
 * - Paused for named reasons ('load', 'drag', 'resync'). While paused, events are buffered and
 *   the gap timer doesn't run.
 * - revision ≤ current → duplicate or already in the snapshot → dropped.
 * - revision = current + 1 → applied, then any buffered successors.
 * - Further ahead → held in the reorder buffer; if the gap is still there after GAP_MS → resync().
 * - resync() = fetch a snapshot and replay held events > R. One at a time; deferred during a drag.
 *
 * @param {object} o
 * @param {(type: string, payload: any) => void} o.apply     applies ONE event (dispatches remoteEvent)
 * @param {() => number} o.getRevision                        the client's current revision
 * @param {() => Promise<boolean>} o.fetchSnapshot           loads a snapshot; true on success
 * @param {() => boolean} [o.needsResync]                     checked after each apply
 * @param {number} [o.gapMs]
 */
export function createEventPipeline({ apply, getRevision, fetchSnapshot, needsResync = () => false, gapMs = 500 }) {
  const paused = new Set();
  let buffer = [];
  const ahead = new Map();          // revision → event
  let gapTimer = null;
  let resyncing = false;
  let resyncWanted = false;
  let disposed = false;

  const clearGap = () => {
    clearTimeout(gapTimer);
    gapTimer = null;
  };
  const armGap = () => {
    if (gapTimer || paused.size || disposed) return;
    gapTimer = setTimeout(() => {
      gapTimer = null;
      resync();
    }, gapMs);
  };

  function deliver(evt) {
    apply(evt.type, evt.payload);
    if (needsResync()) resync();
  }

  function process(evt) {
    const r = evt.payload?.revision;
    const cur = getRevision();
    if (typeof r !== 'number' || r <= cur) return;
    if (r !== cur + 1) {
      ahead.set(r, evt);
      armGap();
      return;
    }
    deliver(evt);
    drain();
  }

  function drain() {
    let cur = getRevision();
    for (const r of ahead.keys()) if (r <= cur) ahead.delete(r);
    while (ahead.has(cur + 1) && !paused.size) {
      const evt = ahead.get(cur + 1);
      ahead.delete(cur + 1);
      deliver(evt);
      cur = getRevision();
    }
    if (ahead.size) armGap();
    else clearGap();
  }

  function flush() {
    const pending = [...buffer, ...ahead.values()].sort((a, b) => a.payload.revision - b.payload.revision);
    buffer = [];
    ahead.clear();
    for (const evt of pending) {
      if (paused.size) {              // an apply triggered a resync: keep the rest for later
        buffer.push(evt);
        continue;
      }
      process(evt);
    }
  }

  function pause(reason) {
    paused.add(reason);
    clearGap();
  }

  function resume(reason) {
    paused.delete(reason);
    if (paused.size || disposed) return;
    if (resyncWanted) {
      resyncWanted = false;
      resync();
      return;
    }
    flush();
  }

  /** Reload the board and replay everything newer than the snapshot. */
  function resync() {
    if (disposed) return Promise.resolve();
    if (paused.has('drag')) {         // never change lists under the pointer; run on drop
      resyncWanted = true;
      return Promise.resolve();
    }
    if (resyncing) return Promise.resolve();
    resyncing = true;
    pause('resync');
    return fetchSnapshot()
      .catch(() => false)
      .finally(() => {
        resyncing = false;
        resume('resync');
      });
  }

  return {
    push(type, payload) {
      if (disposed) return;
      if (paused.size) buffer.push({ type, payload });
      else process({ type, payload });
    },
    pause,
    resume,
    resync,
    isPaused: () => paused.size > 0,
    dispose() {
      disposed = true;
      clearGap();
      buffer = [];
      ahead.clear();
    },
  };
}
