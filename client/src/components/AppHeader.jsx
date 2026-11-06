import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { logout, selectUser } from '../features/auth/authSlice.js';
import { Avatar } from './ui/Avatar.jsx';

export function AppHeader({ children }) {
  const user = useSelector(selectUser);
  const dispatch = useDispatch();

  const logoutEverywhere = async () => {
    await dispatch(logout({ everywhere: true }));
    toast.success('Logged out on every device');
  };

  return (
    <header className="topbar">
      <div className="topbar__left">
        <Link to="/boards" className="brand"><span className="brand__mark" aria-hidden="true" />SyncBoard</Link>
        {children}
      </div>
      <div className="topbar__right">
        <Avatar user={user} />
        <span className="topbar__name">{user.name}</span>
        <button className="btn" onClick={() => dispatch(logout())}>Log out</button>
        <button className="btn btn--ghost" onClick={logoutEverywhere} title="Log out on every device">Everywhere</button>
      </div>
    </header>
  );
}
