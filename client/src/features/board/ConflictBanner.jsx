const FIELD_NAME = { title: 'the title', description: 'the description' };

/**
 * A REAL conflict: someone else changed a field the user is also editing (docs/05).
 * Autosave is on hold until the user picks one of the three actions.
 */
export function ConflictBanner({ conflict, byName, onTheirs, onMine, onCopy }) {
  const what = conflict.fields.map((f) => FIELD_NAME[f] ?? f).join(' and ');
  return (
    <div className="banner banner--conflict" role="alert">
      <span><strong>{byName ?? 'Someone'}</strong> changed {what} while you were editing.</span>
      <span className="banner__actions">
        <button type="button" className="btn" onClick={onTheirs}>Use theirs</button>
        <button type="button" className="btn btn--primary" onClick={onMine}>Keep mine</button>
        <button type="button" className="btn btn--ghost" onClick={onCopy}>Copy mine</button>
      </span>
    </div>
  );
}
