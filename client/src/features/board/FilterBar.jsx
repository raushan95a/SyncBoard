import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Avatar } from '../../components/ui/Avatar.jsx';
import { LABEL_HEX } from './cardUtils.js';
import { NO_FILTERS, isActive, parseFilters, writeFilters } from './filters.js';
import { selectLabels, selectMembers } from './selectors.js';

const DUE_LABEL = { overdue: 'Overdue', week: 'Due this week', none: 'No due date' };
const TEXT_DEBOUNCE_MS = 200;
const toggle = (arr, id) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

/**
 * Filter bar (docs/11 F15). Writes only to the URL (replace, no history spam); BoardView mirrors
 * the URL into the store, where the per-column selectors pick it up.
 */
export function FilterBar() {
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const members = useSelector(selectMembers);
  const labels = useSelector(selectLabels);
  const [text, setText] = useState(filters.text);
  const [open, setOpen] = useState(isActive(filters));

  const update = (patch) => setParams((p) => writeFilters(p, { ...parseFilters(p), ...patch }), { replace: true });

  // Typing is debounced; the URL catches up 200 ms after the last keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setParams((p) => (parseFilters(p).text === text ? p : writeFilters(p, { ...parseFilters(p), text })), { replace: true });
    }, TEXT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, setParams]);

  const active = isActive(filters);
  const clear = () => {
    setText('');
    setParams((p) => writeFilters(p, NO_FILTERS), { replace: true });
  };

  return (
    <div className="filter-bar" role="search">
      <input className="input filter-bar__text" type="search" placeholder="Filter cards…" aria-label="Filter cards by text"
        value={text} onChange={(e) => setText(e.target.value)} />
      <button type="button" className={`btn btn--ghost${open ? ' btn--on' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Filters{active ? ` (${filters.memberIds.length + filters.labelIds.length + (filters.due ? 1 : 0) + (filters.text ? 1 : 0)})` : ''}
      </button>
      {active && <button type="button" className="btn btn--ghost" onClick={clear}>Clear</button>}

      {open && (
        <div className="filter-bar__panel">
          <div className="chips" aria-label="Filter by member">
            {members.map((m) => {
              const on = filters.memberIds.includes(m.userId);
              return (
                <button key={m.userId} type="button" className={`member-chip${on ? ' member-chip--on' : ''}`} aria-pressed={on}
                  onClick={() => update({ memberIds: toggle(filters.memberIds, m.userId) })}>
                  <Avatar user={m} size={18} /> {m.name}
                </button>
              );
            })}
          </div>
          <div className="chips" aria-label="Filter by label">
            {labels.map((l) => {
              const on = filters.labelIds.includes(l._id);
              return (
                <button key={l._id} type="button" className={`label-chip${on ? ' label-chip--on' : ''}`} style={{ '--c': LABEL_HEX[l.color] }}
                  aria-pressed={on} onClick={() => update({ labelIds: toggle(filters.labelIds, l._id) })}>
                  {l.name || l.color}
                </button>
              );
            })}
          </div>
          <select className="input input--sm" aria-label="Filter by due date" value={filters.due ?? ''}
            onChange={(e) => update({ due: e.target.value || null })}>
            <option value="">Any due date</option>
            {Object.entries(DUE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}
