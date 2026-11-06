import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useStore } from 'react-redux';
import toast from 'react-hot-toast';
import { exists } from './ops.js';
import {
  initDraft, edit, saveRequest, saved, remoteUpdate, conflicted, takeTheirs, keepMine, myConflictingText, dirtyFields,
} from './cardDraft.js';
import { saveContent, messageFor } from './thunks.js';
import { selectConfirmedCard, selectLastActor } from './selectors.js';

export const AUTOSAVE_MS = 800;
const storageKey = (cardId) => `syncboard:draft:${cardId}`;

/** A draft left behind by a closed tab or a crash (docs/05: backed up to sessionStorage). */
function restore(cardId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(cardId)) ?? 'null');
    return saved?.draft && saved?.base ? { draft: saved.draft, base: saved.base, changedBy: {}, conflict: null } : null;
  } catch {
    return null;
  }
}
function backup(cardId, s) {
  try {
    if (dirtyFields(s).length) sessionStorage.setItem(storageKey(cardId), JSON.stringify({ draft: s.draft, base: s.base }));
    else sessionStorage.removeItem(storageKey(cardId));
  } catch {
    // storage unavailable (private mode, quota): the draft still lives in memory
  }
}

/**
 * The card modal's title/description editing (docs/05 — Card Modal: Autosave and Conflicts):
 * debounced autosave with one request in flight, three-way merge on 409, the "changed by X" pill,
 * a conflict banner for real conflicts, flush on close, and a sessionStorage backup.
 *
 * @param {object} card  the card when the modal opened
 */
export function useCardDraft(card) {
  const dispatch = useDispatch();
  const store = useStore();
  const cardId = card._id;
  const [state, setState] = useState(() => restore(cardId) ?? initDraft(card));
  const [saving, setSaving] = useState(false);
  const stateRef = useRef(state);
  const timer = useRef(null);
  const inflight = useRef(false);
  const again = useRef(false);

  /** Every change goes through here, so async code always sees the latest state. */
  const update = useCallback((fn) => {
    const next = fn(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    backup(cardId, next);
    setState(next);
  }, [cardId]);

  const actor = useCallback(() => selectLastActor(store.getState(), cardId) ?? null, [store, cardId]);

  /** One request in flight; edits made meanwhile are combined into the next request. */
  const save = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current) {
      again.current = true;
      return;
    }
    inflight.current = true;
    setSaving(true);
    try {
      for (;;) {
        const req = saveRequest(stateRef.current);
        if (!req) break;
        const res = await dispatch(saveContent(cardId, req.fields, { version: req.version }));
        if (res.ok) {
          update((s) => saved(s, req.fields, res.data.card));
        } else if (res.error?.code === 'CONFLICT' && res.error.details?.current) {
          let retry = false;
          update((s) => {
            const out = conflicted(s, res.error.details.current, actor());
            retry = out.retry;
            return out.state;
          });
          if (retry) again.current = true;   // different fields: merged silently, save again
        }
        // Any other failure: runOp's toast explained it; the draft keeps the user's text.
        if (!again.current) break;
        again.current = false;
      }
    } finally {
      inflight.current = false;
      setSaving(false);
    }
  }, [dispatch, cardId, update, actor]);

  const setField = useCallback((field, value) => {
    update((s) => edit(s, field, value));
    clearTimeout(timer.current);
    timer.current = setTimeout(save, AUTOSAVE_MS);
  }, [update, save]);

  // Teammates' confirmed changes (and our own echoes) flow into the draft. A store subscription,
  // not a render-time read: it must see EVERY confirmed version, in order.
  useEffect(() => {
    let last;
    const check = () => {
      const confirmed = selectConfirmedCard(store.getState(), cardId);
      if (confirmed === last) return;
      last = confirmed;
      if (exists(confirmed)) update((s) => remoteUpdate(s, confirmed, actor()));
    };
    check();
    return store.subscribe(check);
  }, [store, cardId, update, actor]);

  // Closing the modal flushes a pending debounce immediately (docs/11 F7).
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (saveRequest(stateRef.current)) save();
  }, [save]);

  const resolve = {
    theirs: () => update(takeTheirs),
    mine: () => {
      update(keepMine);
      save();
    },
    copy: async () => {
      const text = myConflictingText(stateRef.current);
      try {
        await navigator.clipboard.writeText(text);
        toast.success('Your text was copied to the clipboard');
      } catch (err) {
        toast.error(messageFor(err, 'Could not copy to the clipboard'));
        return;                            // never discard the user's text if the copy failed
      }
      update(takeTheirs);
    },
  };

  return { ...state, dirty: dirtyFields(state), saving, setField, flush: save, resolve };
}
