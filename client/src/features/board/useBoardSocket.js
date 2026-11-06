import { useCallback, useEffect, useRef } from 'react';
import { useDispatch, useStore } from 'react-redux';
import { EVT, REVISIONED_EVENTS } from '@syncboard/shared/events';
import { getSocket } from '../../api/socket.js';
import { createEventPipeline } from './eventPipeline.js';
import { boardGone, boardLeft, connectionChanged, remoteEvent } from './boardSlice.js';
import { loadBoard } from './thunks.js';

const JOIN_TIMEOUT_MS = 10_000;

/**
 * Keeps one board in sync (docs/05 — Socket Hook, docs/11 F3/F16).
 *
 *   connect → join (ack) → pause('load') → GET snapshot R → resume: buffered events ≤ R dropped, rest applied
 *
 * Joining BEFORE fetching means no committed change can fall between the snapshot and the stream.
 * The same flow runs on every reconnect (server restart, network loss), so recovery needs no user
 * action. Returns stable pauseDrag/resumeDrag callbacks for the drag-and-drop handlers.
 */
export function useBoardSocket(boardId) {
  const dispatch = useDispatch();
  const store = useStore();
  const pipelineRef = useRef(null);

  useEffect(() => {
    const s = getSocket();
    const state = () => store.getState();
    let disposed = false;

    const pipeline = createEventPipeline({
      apply: (type, payload) => dispatch(remoteEvent({ type, payload, myUserId: state().auth.user?._id })),
      getRevision: () => state().board.revision,
      fetchSnapshot: () => dispatch(loadBoard(boardId)),
      needsResync: () => state().board.needsResync,
    });
    pipelineRef.current = pipeline;

    const onConnect = async () => {
      pipeline.pause('load');
      try {
        const ack = await s.timeout(JOIN_TIMEOUT_MS).emitWithAck(EVT.BOARD_JOIN, { boardId });
        if (disposed) return;
        if (ack?.error === 'NOT_FOUND') {
          dispatch(boardGone({ boardId, reason: 'not-found' }));
          return;
        }
        dispatch(connectionChanged('online'));
      } catch {
        // No ack (timeout): still load the board over REST; the next reconnect retries the join.
      }
      if (disposed) return;
      await dispatch(loadBoard(boardId));
      if (!disposed) pipeline.resume('load');
    };
    const onDisconnect = () => dispatch(connectionChanged('reconnecting'));

    const handlers = Object.fromEntries(REVISIONED_EVENTS.map((e) => [e, (p) => pipeline.push(e, p)]));
    handlers[EVT.BOARD_DELETED] = (p) => p.boardId === boardId && dispatch(boardGone({ boardId, reason: 'deleted', by: p.actorName }));
    handlers[EVT.ACCESS_REVOKED] = (p) => p.boardId === boardId && dispatch(boardGone({ boardId, reason: 'removed' }));

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    for (const [e, h] of Object.entries(handlers)) s.on(e, h);

    if (s.connected) {
      onConnect();
    } else {
      // Show the board over REST while the socket (re)connects; 'connect' then joins and resyncs.
      dispatch(connectionChanged('reconnecting'));
      dispatch(loadBoard(boardId));
    }

    return () => {
      disposed = true;
      if (s.connected) s.emit(EVT.BOARD_LEAVE, { boardId });
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      for (const [e, h] of Object.entries(handlers)) s.off(e, h);
      pipeline.dispose();
      pipelineRef.current = null;
      dispatch(boardLeft());
    };
  }, [boardId, dispatch, store]);

  const pauseDrag = useCallback(() => pipelineRef.current?.pause('drag'), []);
  const resumeDrag = useCallback(() => pipelineRef.current?.resume('drag'), []);
  return { pauseDrag, resumeDrag };
}
