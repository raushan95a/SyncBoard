/**
 * Card modal draft model (docs/05 — Card Modal: Autosave and Conflicts). Pure functions over
 *
 *   draft     = { title, description }            what's in the inputs
 *   base      = { title, description, version }   the server values the user started editing from
 *   changedBy = { [field]: actorId }              "X changed this" pills on dirty fields
 *   conflict  = null | { fields, current, by }    a REAL conflict waiting for the user's choice
 *
 * dirty = fields where draft !== base. Only dirty fields are ever sent.
 */

export const FIELDS = ['title', 'description'];

const pick = (src) => ({ title: src.title, description: src.description });

export function initDraft(card) {
  return { draft: pick(card), base: { ...pick(card), version: card.version }, changedBy: {}, conflict: null };
}

export const dirtyFields = (s) => FIELDS.filter((f) => s.draft[f] !== s.base[f]);

/** The request body for the next save, or null when nothing is dirty (or a conflict is open). */
export function saveRequest(s) {
  if (s.conflict) return null;
  const fields = Object.fromEntries(dirtyFields(s).map((f) => [f, s.draft[f]]));
  if (fields.title !== undefined && !fields.title.trim()) delete fields.title;   // never save an empty title
  if (!Object.keys(fields).length) return null;
  if (fields.title !== undefined) fields.title = fields.title.trim();
  return { fields, version: s.base.version };
}

export function edit(s, field, value) {
  return { ...s, draft: { ...s.draft, [field]: value } };
}

/**
 * Save succeeded: the sent fields and the new version become the base. Anything typed since the
 * request left stays dirty and goes out with the next save.
 */
export function saved(s, sentFields, card) {
  const base = { ...s.base, version: card.version };
  const changedBy = { ...s.changedBy };
  for (const f of Object.keys(sentFields)) {
    base[f] = card[f];
    delete changedBy[f];
  }
  return { ...s, base, changedBy };
}

/**
 * A newer CONFIRMED card arrived (a teammate's save, or our own echo).
 * - Field not dirty → draft and base take the new value.
 * - Field dirty, and the new value equals our draft → converged (e.g. our own echo): base takes it.
 * - Field dirty, and the server value moved → leave draft AND base alone, show "X changed this".
 * The version only advances if no dirty field was changed underneath us; otherwise the next save
 * must hit 409, so the user gets to decide instead of silently overwriting the teammate.
 */
export function remoteUpdate(s, card, actorId) {
  if (card.version <= s.base.version) return s;
  const draft = { ...s.draft };
  const base = { ...s.base };
  const changedBy = { ...s.changedBy };
  let clobbered = false;
  for (const f of FIELDS) {
    const dirty = s.draft[f] !== s.base[f];
    if (!dirty || card[f] === s.draft[f]) {
      draft[f] = card[f];
      base[f] = card[f];
      delete changedBy[f];
    } else if (card[f] !== s.base[f]) {
      changedBy[f] = actorId ?? null;
      clobbered = true;
    }
  }
  if (!clobbered) base.version = card.version;
  return { ...s, draft, base, changedBy };
}

/**
 * 409 with the server's `current` card: three-way check per dirty field.
 * - current[f] === base[f] → nobody else touched it → safe.
 * - otherwise → a real conflict.
 * All safe → { retry: true }: take the other fields and the version from `current`, save again,
 * no banner. Otherwise open the banner for the conflicting fields.
 */
export function conflicted(s, current, actorId) {
  const dirty = dirtyFields(s);
  const fields = dirty.filter((f) => current[f] !== s.base[f]);
  const draft = { ...s.draft };
  const base = { ...s.base };
  for (const f of FIELDS) {
    if (!dirty.includes(f)) {
      draft[f] = current[f];
      base[f] = current[f];
    }
  }
  if (!fields.length) {
    return { state: { ...s, draft, base: { ...base, version: current.version }, conflict: null }, retry: true };
  }
  return { state: { ...s, draft, base, conflict: { fields, current, by: actorId ?? null } }, retry: false };
}

/** [Use theirs]: the draft takes the server's values. */
export function takeTheirs(s) {
  const { current } = s.conflict;
  return { ...s, draft: pick(current), base: { ...pick(current), version: current.version }, changedBy: {}, conflict: null };
}

/** [Keep mine]: overwrite deliberately — rebase onto the server's version and save again. */
export function keepMine(s) {
  const { current } = s.conflict;
  return { ...s, base: { ...pick(current), version: current.version }, changedBy: {}, conflict: null };
}

/** The text for [Copy mine]: the user's version of each conflicting field. */
export function myConflictingText(s) {
  return s.conflict.fields.map((f) => s.draft[f]).join('\n\n');
}
