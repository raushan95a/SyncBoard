import { io } from 'socket.io-client';
import { EVT } from '@syncboard/shared/events';

/**
 * One socket per tab (docs/05 — Socket Hook). Created with autoConnect: false; connected after
 * login and disconnected on logout. Same origin (Vite proxies /socket.io), so the auth cookie
 * rides along on the handshake.
 *
 * The listeners registered in initSocket() are GLOBAL and live for the whole session. Board
 * listeners are added and removed by useBoardSocket. Never call removeAllListeners().
 */
let socket = null;
let wanted = false;              // true between connectSocket() and disconnectSocket()
const boardsChangedSubs = new Set();

export function getSocket() {
  socket ??= io({ autoConnect: false, transports: ['websocket', 'polling'] });
  return socket;
}

/**
 * @param {object} handlers
 * @param {() => void} handlers.onUnauthenticated  handshake rejected (expired or revoked session)
 * @param {() => void} handlers.onSessionRevoked   logout everywhere from another tab/device
 */
export function initSocket({ onUnauthenticated, onSessionRevoked }) {
  const s = getSocket();
  s.on('connect_error', (err) => {
    // A middleware rejection is final: socket.io won't retry it. Network errors keep retrying.
    if (err?.message === 'UNAUTHENTICATED') onUnauthenticated();
  });
  s.on(EVT.SESSION_REVOKED, onSessionRevoked);
  // A server-initiated disconnect (graceful shutdown on deploy/restart) is NOT retried by
  // socket.io on its own. Reconnect after a random 0.5–2 s, so a fleet of clients doesn't
  // stampede the new instance. A revoked session is rejected at the handshake → logout.
  s.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect') return;
    setTimeout(() => {
      if (wanted && !s.connected && !s.active) s.connect();
    }, 500 + Math.random() * 1500);
  });
  s.on(EVT.BOARDS_CHANGED, (p) => boardsChangedSubs.forEach((fn) => fn(p)));
}

/** (Re)connect with the current cookie, e.g. right after logging in. */
export function connectSocket() {
  wanted = true;
  const s = getSocket();
  if (s.connected || s.active) s.disconnect();
  s.connect();
}

export function disconnectSocket() {
  wanted = false;
  socket?.disconnect();
}

/** The boards page subscribes while mounted. Returns an unsubscribe function. */
export function onBoardsChanged(fn) {
  boardsChangedSubs.add(fn);
  return () => boardsChangedSubs.delete(fn);
}
