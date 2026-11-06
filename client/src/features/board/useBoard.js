import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { http } from '../../api/http.js';

/**
 * Phase 2 data layer (ADR-023): load the board snapshot, and after every change simply
 * refetch it. No optimistic state; Phase 3 replaces this with the pending-ops engine.
 * Mount with `key={boardId}` so switching boards starts from a clean state.
 */
export function useBoard(boardId) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  const reload = useCallback(async () => {
    try {
      const data = await http.get(`/boards/${boardId}`);
      setState({ status: 'ready', data, error: null });
    } catch (error) {
      setState((s) => ({
        status: error.status === 404 ? 'gone' : s.data ? 'ready' : 'error',
        data: s.data,
        error,
      }));
    }
  }, [boardId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /**
   * Runs a mutation, shows a toast on failure, then refetches either way.
   * @returns {Promise<{ ok: boolean, data?: any, error?: any }>}
   */
  const run = useCallback(async (fn, fallbackMessage = 'Something went wrong') => {
    try {
      return { ok: true, data: await fn() };
    } catch (error) {
      if (error.status !== 401) toast.error(messageFor(error, fallbackMessage));
      return { ok: false, error };
    } finally {
      await reload();
    }
  }, [reload]);

  return { ...state, reload, run };
}

export function messageFor(error, fallback) {
  switch (error?.code) {
    case 'NOT_FOUND': return 'That item no longer exists';
    case 'FORBIDDEN': return 'You don\'t have permission to do that';
    case 'CONFLICT': return 'Someone else changed this card. Showing their version.';
    case 'RATE_LIMITED': return 'Too many requests. Slow down a little.';
    case 'NETWORK':
    case 'TIMEOUT': return error.message;
    default: return error?.message || fallback;
  }
}
