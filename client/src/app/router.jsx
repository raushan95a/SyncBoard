import { createBrowserRouter, Navigate, Link } from 'react-router-dom';
import { RequireAuth, PublicOnly } from '../features/auth/guards.jsx';
import { LoginPage, RegisterPage } from '../features/auth/AuthPages.jsx';
import { BoardsPage } from '../features/boards/BoardsPage.jsx';
import { BoardRoute } from '../features/board/BoardPage.jsx';
import { CardModalRoute } from '../features/board/CardModal.jsx';

function NotFound() {
  return (
    <main className="auth">
      <div className="auth__card">
        <h1>Page not found</h1>
        <p><Link to="/boards">Back to your boards</Link></p>
      </div>
    </main>
  );
}

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/boards" replace /> },
  {
    element: <PublicOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/boards', element: <BoardsPage /> },
      {
        path: '/b/:boardId',
        element: <BoardRoute />,
        children: [{ path: 'c/:cardId', element: <CardModalRoute /> }],   // modal over the board
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
