/** Board label colors (shared LABEL_COLORS → swatches). */
export const LABEL_HEX = {
  green: '#22a06b', yellow: '#d4a106', orange: '#e2741c', red: '#d93a3a', purple: '#8f5bd6',
  blue: '#2f74d6', sky: '#1aa3c9', lime: '#6aa312', pink: '#d6458f', gray: '#768092',
};

const DAY = 24 * 3600 * 1000;

/**
 * Due-date chip state (docs/05 — UX): green when completed, red when overdue,
 * amber within 24 h, gray otherwise.
 * @returns {'done' | 'overdue' | 'soon' | 'later' | null}
 */
export function dueState(card, now = Date.now()) {
  if (!card.dueDate) return null;
  if (card.completed) return 'done';
  const t = new Date(card.dueDate).getTime();
  if (t < now) return 'overdue';
  if (t - now <= DAY) return 'soon';
  return 'later';
}

export const formatDue = (iso) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** ISO (UTC) → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value (local time) → ISO (UTC), or null when cleared. */
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);
