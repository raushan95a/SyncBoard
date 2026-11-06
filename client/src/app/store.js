import { configureStore } from '@reduxjs/toolkit';
import authReducer, { loggedOut } from '../features/auth/authSlice.js';
import boardReducer from '../features/board/boardSlice.js';
import { setUnauthorizedHandler } from '../api/http.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    board: boardReducer,
  },
});

// A 401 on any non-auth request means the session is gone (expired, revoked).
// Clearing the user makes RequireAuth redirect to /login?next=<current>.
setUnauthorizedHandler(() => {
  if (store.getState().auth.user) store.dispatch(loggedOut());
});
