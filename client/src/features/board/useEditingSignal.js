import { useCallback, useEffect, useRef } from 'react';
import { EVT } from '@syncboard/shared/events';
import { getSocket } from '../../api/socket.js';

export const HEARTBEAT_MS = 10_000;

/**
 * "X is editing…" (F14): start on focus, heartbeat every 10 s, stop on blur and on close.
 * The server expires it after 30 s without a heartbeat, so a crashed tab can't leave it stuck.
 * Advisory only — correctness comes from the 409.
 */
export function useEditingSignal(cardId) {
  const beat = useRef(null);

  const stop = useCallback(() => {
    if (!beat.current) return;
    clearInterval(beat.current);
    beat.current = null;
    getSocket().emit(EVT.CARD_EDITING_STOP, { cardId });
  }, [cardId]);

  const start = useCallback(() => {
    if (beat.current) return;
    const s = getSocket();
    s.emit(EVT.CARD_EDITING_START, { cardId });
    beat.current = setInterval(() => s.emit(EVT.CARD_EDITING_HEARTBEAT, { cardId }), HEARTBEAT_MS);
  }, [cardId]);

  useEffect(() => stop, [stop]);
  return { onFocus: start, onBlur: stop };
}
