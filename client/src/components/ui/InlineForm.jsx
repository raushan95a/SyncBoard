import { useState } from 'react';

/**
 * "+ Add a card" / "+ Add a list": a button that turns into a small form. Enter submits and
 * keeps the form open for the next item; Escape closes it (docs/11 F5).
 */
export function InlineAdd({ label, placeholder, maxLength, onSubmit, multiline = false }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return <button className="add-btn" onClick={() => setOpen(true)}>+ {label}</button>;
  }

  const submit = async (e) => {
    e?.preventDefault();
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    const ok = await onSubmit(title);
    setBusy(false);
    if (ok !== false) setValue('');
  };
  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); setValue(''); }
    if (multiline && e.key === 'Enter' && !e.shiftKey) submit(e);
  };
  const Field = multiline ? 'textarea' : 'input';

  return (
    <form className="inline-add" onSubmit={submit}>
      <Field
        autoFocus value={value} placeholder={placeholder} maxLength={maxLength} rows={multiline ? 2 : undefined}
        aria-label={placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown}
      />
      <div className="inline-add__actions">
        <button className="btn btn--primary" disabled={busy || !value.trim()}>Add</button>
        <button type="button" className="btn btn--ghost" onClick={() => { setOpen(false); setValue(''); }}>Cancel</button>
      </div>
    </form>
  );
}

/** Click-to-edit text: saves on Enter or blur, Escape cancels. Read-only when !editable. */
export function EditableText({ value, onSave, editable, maxLength, className = '', as: Tag = 'span', label }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editable) return <Tag className={className}>{value}</Tag>;
  if (!editing) {
    return (
      <Tag className={`${className} editable`} role="button" tabIndex={0} aria-label={`Edit ${label}`}
        onClick={() => { setDraft(value); setEditing(true); }}
        onKeyDown={(e) => e.key === 'Enter' && (setDraft(value), setEditing(true))}>
        {value}
      </Tag>
    );
  }
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onSave(next);
  };
  return (
    <input
      className={`${className} editable__input`} autoFocus value={draft} maxLength={maxLength} aria-label={label}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
    />
  );
}
