import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { logout, selectUser } from '../auth/authSlice.js';
import { Avatar } from '../../components/ui/Avatar.jsx';

/** Phase 1 placeholder: proves the session works. Boards arrive in Phase 2. */
export function BoardsPage() {
  const user = useSelector(selectUser);
  const dispatch = useDispatch();

  const logoutEverywhere = async () => {
    await dispatch(logout({ everywhere: true }));
    toast.success('Logged out on every device');
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand"><span className="brand__mark" aria-hidden="true" />SyncBoard</div>
        <div className="topbar__right">
          <Avatar user={user} />
          <span className="topbar__name">{user.name}</span>
          <button className="btn" onClick={() => dispatch(logout())}>Log out</button>
          <button className="btn btn--ghost" onClick={logoutEverywhere}>Log out everywhere</button>
        </div>
      </header>
      <main className="page__body">
        <h1>Your boards</h1>
        <p className="muted">Signed in as {user.email}. Boards arrive in Phase 2.</p>
      </main>
    </div>
  );
}
