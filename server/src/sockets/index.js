import { Server } from 'socket.io';
import { parseCookie } from 'cookie';
import { EVT, boardRoom, userRoom } from '@syncboard/shared/events';
import { objectId } from '@syncboard/shared/schemas';
import { User } from '../models/User.js';
import { Board } from '../models/Board.js';
import { COOKIE_NAME, verifyToken } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';
import { setIO } from './publisher.js';

/**
 * Socket.io server (docs/04). Same origin as the API, so no CORS. Clients only RECEIVE board
 * data here; every mutation goes through REST and is broadcast after its transaction commits.
 */
export function createIO(httpServer) {
  const io = new Server(httpServer, { maxHttpBufferSize: 1e5, serveClient: false });
  io.use(socketAuth);
  io.on('connection', (socket) => {
    socket.join(userRoom(socket.data.user.id));
    registerBoardHandlers(io, socket);
  });
  setIO(io);
  return io;
}

/** Handshake auth: the same cookie + tokenVersion check as REST (docs/06). */
export async function socketAuth(socket, next) {
  try {
    const token = parseCookie(socket.handshake.headers.cookie || '')[COOKIE_NAME];
    const { sub, tv } = verifyToken(token);
    const user = await User.findById(sub, 'name avatarColor tokenVersion').lean();
    if (!user || user.tokenVersion !== tv) throw new Error('revoked');
    socket.data.user = { id: String(user._id), name: user.name, avatarColor: user.avatarColor };
    next();
  } catch {
    next(new Error('UNAUTHENTICATED'));     // client: connect_error → /login
  }
}

const isMember = (boardId, userId) => Board.exists({ _id: boardId, 'members.userId': userId });

function registerBoardHandlers(io, socket) {
  const userId = socket.data.user.id;
  const reply = (ack, body) => (typeof ack === 'function' ? ack(body) : undefined);

  socket.on(EVT.BOARD_JOIN, async (payload, ack) => {
    try {
      const boardId = payload?.boardId;
      if (!objectId.safeParse(boardId).success) return reply(ack, { error: 'BAD_REQUEST' });
      if (!(await isMember(boardId, userId))) return reply(ack, { error: 'NOT_FOUND' });
      if (socket.data.boardId && socket.data.boardId !== boardId) await leaveBoard(io, socket);   // one board per socket
      await socket.join(boardRoom(boardId));
      // Re-check AFTER joining (ADR-018): a removal between the first check and the join would
      // have run socketsLeave() before we were in the room.
      if (!(await isMember(boardId, userId))) {
        await socket.leave(boardRoom(boardId));
        return reply(ack, { error: 'NOT_FOUND' });
      }
      socket.data.boardId = boardId;
      reply(ack, { ok: true });
      await emitPresence(io, boardId);
    } catch (err) {
      logger.error({ err }, 'board:join failed');
      reply(ack, { error: 'INTERNAL' });
    }
  });

  socket.on(EVT.BOARD_LEAVE, async (payload) => {
    if (socket.data.boardId && payload?.boardId === socket.data.boardId) await leaveBoard(io, socket);
  });

  socket.on('disconnecting', () => {
    const { boardId } = socket.data;
    if (!boardId) return;
    // The socket is still in the room during 'disconnecting'; recompute once it has left.
    setImmediate(() => emitPresence(io, boardId).catch(() => {}));
  });
}

async function leaveBoard(io, socket) {
  const { boardId } = socket.data;
  socket.data.boardId = null;
  await socket.leave(boardRoom(boardId));
  await emitPresence(io, boardId);
}

/** Full presence list for a board, deduplicated by user (docs/04 — Presence). */
export async function emitPresence(io, boardId) {
  const sockets = await io.in(boardRoom(boardId)).fetchSockets();
  const users = [...new Map(sockets.map((s) => [s.data.user.id, s.data.user])).values()];
  io.to(boardRoom(boardId)).emit(EVT.PRESENCE_UPDATE, { boardId, users });
}
