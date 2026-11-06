/**
 * Board filters (docs/05 — Filters and Search, docs/11 F15). The whole board is in memory, so
 * filtering is a client-side selector; there's no server round trip. The URL query string is
 * the source of truth, so a filtered view can be shared:  ?q=text&m=u1,u2&l=l1&due=overdue
 */

export const DUE_OPTIONS = ['overdue', 'week', 'none'];
export const NO_FILTERS = Object.freeze({ text: '', memberIds: Object.freeze([]), labelIds: Object.freeze([]), due: null });

const DAY = 24 * 3600 * 1000;
const list = (v) => (v ? v.split(',').filter(Boolean) : []);

/** URLSearchParams → filters (unknown values are ignored). */
export function parseFilters(params) {
  const text = (params.get('q') ?? '').slice(0, 200);
  const due = params.get('due');
  const f = { text, memberIds: list(params.get('m')), labelIds: list(params.get('l')), due: DUE_OPTIONS.includes(due) ? due : null };
  return isActive(f) ? f : NO_FILTERS;
}

/** filters → a new URLSearchParams based on `params` (other keys are kept). */
export function writeFilters(params, f) {
  const next = new URLSearchParams(params);
  const set = (k, v) => (v ? next.set(k, v) : next.delete(k));
  set('q', f.text);
  set('m', f.memberIds.join(','));
  set('l', f.labelIds.join(','));
  set('due', f.due);
  return next;
}

export const isActive = (f) => !!(f.text.trim() || f.memberIds.length || f.labelIds.length || f.due);

export function sameFilters(a, b) {
  return a.text === b.text && a.due === b.due
    && a.memberIds.join() === b.memberIds.join() && a.labelIds.join() === b.labelIds.join();
}

/**
 * Does a card match? All set criteria must hold (AND); within members or labels, any one (OR).
 * Text: case-insensitive, title or description. Due: 'overdue' (past, not done), 'week' (due in
 * the next 7 days, not done), 'none' (no due date).
 */
export function matches(card, f, now = Date.now()) {
  const text = f.text.trim().toLowerCase();
  if (text && !`${card.title}\n${card.description ?? ''}`.toLowerCase().includes(text)) return false;
  if (f.memberIds.length && !card.assigneeIds.some((id) => f.memberIds.includes(id))) return false;
  if (f.labelIds.length && !card.labelIds.some((id) => f.labelIds.includes(id))) return false;
  if (f.due) {
    const t = card.dueDate ? new Date(card.dueDate).getTime() : null;
    if (f.due === 'none' && t !== null) return false;
    if (f.due === 'overdue' && !(t !== null && t < now && !card.completed)) return false;
    if (f.due === 'week' && !(t !== null && t >= now && t - now <= 7 * DAY && !card.completed)) return false;
  }
  return true;
}
