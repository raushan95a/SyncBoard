import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { http, serializeError } from '../../api/http.js';

/**
 * status:
 *  'booting'       — GET /auth/me in flight at app start (full-screen spinner)
 *  'authenticated' — user is set
 *  'anonymous'     — no session; only public routes
 */
const initialState = { user: null, status: 'booting' };

const thunk = (type, fn) => createAsyncThunk(type, async (arg, { rejectWithValue }) => {
  try {
    return await fn(arg);
  } catch (err) {
    return rejectWithValue(serializeError(err));
  }
});

export const bootstrap = thunk('auth/bootstrap', async () => (await http.get('/auth/me')).user);
export const login = thunk('auth/login', async (body) => (await http.post('/auth/login', body)).user);
export const register = thunk('auth/register', async (body) => (await http.post('/auth/register', body)).user);
export const logout = thunk('auth/logout', async ({ everywhere = false } = {}) => {
  await http.post('/auth/logout', everywhere ? { everywhere: true } : {});
});

const setUser = (state, { payload }) => {
  state.user = payload;
  state.status = 'authenticated';
};
const clearUser = (state) => {
  state.user = null;
  state.status = 'anonymous';
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    /** Session ended elsewhere: a 401 from the API, or (Phase 4) session:revoked. */
    loggedOut: clearUser,
  },
  extraReducers: (b) => {
    b.addCase(bootstrap.fulfilled, setUser)
      .addCase(bootstrap.rejected, clearUser)
      .addCase(login.fulfilled, setUser)
      .addCase(register.fulfilled, setUser)
      // Log out locally even if the request fails: the user asked to leave.
      .addCase(logout.fulfilled, clearUser)
      .addCase(logout.rejected, clearUser);
  },
});

export const { loggedOut } = authSlice.actions;
export default authSlice.reducer;

export const selectUser = (s) => s.auth.user;
/** Just the id: a stable primitive, so per-card components never re-render for user changes. */
export const selectUserId = (s) => s.auth.user?._id;
export const selectAuthStatus = (s) => s.auth.status;
