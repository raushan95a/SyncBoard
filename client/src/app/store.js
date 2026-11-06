import { configureStore } from '@reduxjs/toolkit';
import authReducer, { loggedOut } from '../features/auth/authSlice.js';
import boardReducer from '../features/board/boardSlice.js';
import toast from 'react-hot-toast';
import { setUnauthorizedHandler } from '../api/http.js';
import { initSocket } from '../api/socket.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    board: boardReducer,
  },
});

// A 401 on any non-auth request means the session is gone (expired, revoked).
// Clearing the user makes RequireAuth redirect to /login?next=<current>.
const endSession = () => {
  if (store.getState().auth.user) store.dispatch(loggedOut());
};
setUnauthorizedHandler(endSession);

// Session-wide socket listeners (docs/05): a rejected handshake or a logout-everywhere ends the session.
initSocket({
  onUnauthenticated: endSession,
  onSessionRevoked: () => {
    if (store.getState().auth.user) toast('You were logged out on every device');
    endSession();
  },
});
