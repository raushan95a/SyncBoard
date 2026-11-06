import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectAuthStatus } from './authSlice.js';

/** Only allow same-site relative paths, so ?next= can't redirect to another site. */
export function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
    ? next
    : '/boards';
}

/** Protected routes: anonymous users go to /login?next=<where they were>. */
export function RequireAuth() {
  const status = useSelector(selectAuthStatus);
  const location = useLocation();
  if (status === 'authenticated') return <Outlet />;
  const next = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/login?next=${next}`} replace />;
}

/** Login/register: signed-in users go straight to ?next or /boards. */
export function PublicOnly() {
  const status = useSelector(selectAuthStatus);
  const [params] = useSearchParams();
  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <Outlet />;
}
