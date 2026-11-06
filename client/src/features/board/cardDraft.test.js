import { describe, it, expect } from 'vitest';
import {
  initDraft, edit, saveRequest, saved, remoteUpdate, conflicted, takeTheirs, keepMine, myConflictingText,
} from './cardDraft.js';

/**
 * Draft model (docs/05). A tiny in-memory "server" with compare-and-set on `version` drives the
 * concurrent-edit scenarios from docs/11 F7 end to end.
 */
const card0 = { _id: 'c', title: 'Title', description: 'Desc', version: 3 };

function server(card) {
  let db = { ...card };
  return {
    get: () => ({ ...db }),
    /** PATCH /cards/:id/content */
    save({ fields, version }) {
      if (version !== db.version) return { status: 409, current: { ...db } };
      db = { ...db, ...fields, version: db.version + 1 };
      return { status: 200, card: { ...db } };
    },
  };
}

/** Runs one autosave cycle like the hook does: save → (409 → merge → maybe retry). */
function autosave(s, srv, actor = 'bob') {
  const req = saveRequest(s);
  if (!req) return s;
  const res = srv.save(req);
  if (res.status === 200) return saved(s, req.fields, res.card);
  const { state, retry } = conflicted(s, res.current, actor);
  return retry ? autosave(state, srv, actor) : state;
}

describe('saving', () => {
  it('nothing dirty → no request; empty titles are never sent', () => {
    const s = initDraft(card0);
    expect(saveRequest(s)).toBeNull();
    expect(saveRequest(edit(s, 'title', '   '))).toBeNull();
  });

  it('sends only dirty fields with the base version, then chains the next version', () => {
    const srv = server(card0);
    let s = edit(initDraft(card0), 'description', 'New');
    expect(saveRequest(s)).toEqual({ fields: { description: 'New' }, version: 3 });
    s = autosave(s, srv);
    expect(s.base).toMatchObject({ description: 'New', version: 4 });
    expect(autosave(edit(s, 'description', 'Newer'), srv).base.version).toBe(5);
    expect(srv.get()).toMatchObject({ description: 'Newer', version: 5 });
  });

  it('typing during a save stays dirty and goes out next', () => {
    let s = edit(initDraft(card0), 'description', 'a');
    const req = saveRequest(s);
    s = edit(s, 'description', 'ab');                              // typed while in flight
    s = saved(s, req.fields, { ...card0, description: 'a', version: 4 });
    expect(saveRequest(s)).toEqual({ fields: { description: 'ab' }, version: 4 });
  });
});

describe('concurrent edits (docs/11 F7)', () => {
  it('A edits the title while B edits the description → automatic retry, NO banner, both saved', () => {
    const srv = server(card0);
    const a = edit(initDraft(card0), 'title', 'A title');
    const b = edit(initDraft(card0), 'description', 'B desc');
    autosave(b, srv);                                              // B wins the race
    const after = autosave(a, srv);                                // A: 409 → three-way → retry
    expect(after.conflict).toBeNull();
    expect(srv.get()).toMatchObject({ title: 'A title', description: 'B desc', version: 5 });
    expect(after.draft).toEqual({ title: 'A title', description: 'B desc' });
  });

  it('A and B both edit the description → banner for the description only', () => {
    const srv = server(card0);
    const a = edit(edit(initDraft(card0), 'description', 'A desc'), 'title', 'A title');
    autosave(edit(initDraft(card0), 'description', 'B desc'), srv);
    const after = autosave(a, srv);
    expect(after.conflict).toMatchObject({ fields: ['description'], by: 'bob' });
    expect(after.conflict.current.description).toBe('B desc');
    expect(srv.get()).toMatchObject({ description: 'B desc', title: 'Title' });  // nothing silently overwritten
    expect(saveRequest(after)).toBeNull();                         // autosave holds until the user decides
  });

  it('[Use theirs] → draft = server; [Keep mine] → overwrites on purpose; [Copy mine] text', () => {
    const srv = server(card0);
    autosave(edit(initDraft(card0), 'description', 'B desc'), srv);
    const open = autosave(edit(initDraft(card0), 'description', 'A desc'), srv);
    expect(myConflictingText(open)).toBe('A desc');

    const theirs = takeTheirs(open);
    expect(theirs.draft.description).toBe('B desc');
    expect(saveRequest(theirs)).toBeNull();

    const mine = autosave(keepMine(open), srv);
    expect(mine.conflict).toBeNull();
    expect(srv.get()).toMatchObject({ description: 'A desc', version: 5 });
  });
});

describe('remote updates while the modal is open', () => {
  it('a field I am not editing updates in place (draft, base, and version)', () => {
    const s = remoteUpdate(initDraft(card0), { ...card0, title: 'By Bob', version: 4 }, 'bob');
    expect(s.draft.title).toBe('By Bob');
    expect(s.base).toMatchObject({ title: 'By Bob', version: 4 });
    expect(s.changedBy).toEqual({});
  });

  it('a field I am editing: draft and version untouched, pill shown; my next save → 409 → banner', () => {
    const srv = server(card0);
    let s = edit(initDraft(card0), 'description', 'mine');
    const bobs = srv.save({ fields: { description: 'bob' }, version: 3 }).card;
    s = remoteUpdate(s, bobs, 'bob');
    expect(s.draft.description).toBe('mine');
    expect(s.base).toMatchObject({ description: 'Desc', version: 3 });
    expect(s.changedBy).toEqual({ description: 'bob' });
    expect(autosave(s, srv).conflict.fields).toEqual(['description']);
  });

  it('my own echo (same text as my draft) converges without a pill', () => {
    let s = edit(initDraft(card0), 'description', 'mine');
    s = remoteUpdate(s, { ...card0, description: 'mine', version: 4 }, 'me');
    expect(s.changedBy).toEqual({});
    expect(s.base).toMatchObject({ description: 'mine', version: 4 });
    expect(saveRequest(s)).toBeNull();
  });

  it('an older or equal version is ignored', () => {
    const s = initDraft(card0);
    expect(remoteUpdate(s, { ...card0, title: 'old', version: 3 }, 'bob')).toBe(s);
  });
});
