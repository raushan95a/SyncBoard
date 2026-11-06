import { useEffect, useRef } from 'react';

/** Accessible overlay dialog: Escape and backdrop click close it; focus moves inside. */
export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal__backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <button className="modal__close btn btn--ghost" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}
