import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { store } from './app/store.js';
import { router } from './app/router.jsx';
import { bootstrap, selectAuthStatus, selectUser } from './features/auth/authSlice.js';
import { connectSocket, disconnectSocket } from './api/socket.js';
import './index.css';

/** App boot: GET /auth/me once, with a full-screen spinner until it resolves (docs/11 F1). */
function Boot() {
  const dispatch = useDispatch();
  const status = useSelector(selectAuthStatus);
  useEffect(() => {
    dispatch(bootstrap());
  }, [dispatch]);

  // The socket lives exactly as long as the session: connect on login, drop on logout.
  const userId = useSelector(selectUser)?._id;
  useEffect(() => {
    if (!userId) return undefined;
    connectSocket();
    return () => disconnectSocket();
  }, [userId]);

  if (status === 'booting') {
    return <div className="boot" role="status" aria-label="Loading"><span className="spinner" /></div>;
  }
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <Boot />
      <Toaster position="bottom-right" />
    </Provider>
  </StrictMode>,
);
