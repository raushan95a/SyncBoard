import { EVT } from '@syncboard/shared/events';
import { seed } from '@syncboard/shared/position';
import { Board, DEFAULT_LABELS } from '../models/Board.js';
import { List } from '../models/List.js';
import { Card } from '../models/Card.js';
import { Comment } from '../models/Comment.js';
import { mutateBoard, inTransaction } from './mutateBoard.js';
import { assertRoleInTx } from '../middleware/loadResource.js';
import { publish, publishUser } from '../sockets/publisher.js';
import { toBoardDTO, toBoardMetaDTO } from './dto.js';

const MEMBER_FIELDS = 'name email avatarColor';
/** Boards bigger than this delete their children after the commit (docs/02 — Cascades). */
const LARGE_BOARD_CARDS = 1000;

export async function listMyBoards(userId) {
  const boards = await Board.find({ 'members.userId': userId }, { title: 1, members: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 }).lean();
  return boards.map((b) => ({
    _id: String(b._id),
    title: b.title,
    updatedAt: b.updatedAt,
    myRole: b.members.find((m) => String(m.userId) === String(userId))?.role,
  }));
}

export async function createBoard(user, { title, template }) {
  const board = await inTransaction(async (session) => {
    const [created] = await Board.create([{
      title,
      createdBy: user.id,
      members: [{ userId: user.id, role: 'owner' }],
      labels: DEFAULT_LABELS,
    }], { session });
    if (template === 'basic') {
      const keys = seed(3);
      await List.insertMany(['To Do', 'Doing', 'Done'].map((t, i) => ({
        boardId: created._id, title: t, position: keys[i], createdBy: user.id,
      })), { session });
    }
    return created;
  });
  publishUser(user.id, EVT.BOARDS_CHANGED, { boardId: String(board._id), reason: 'created' });
  return { _id: String(board._id), title: board.title, myRole: 'owner', updatedAt: board.updatedAt };
}

/**
 * Board snapshot (docs/02 — Board Load Query). The board is read FIRST, which pins the
 * revision: every change ≤ R is already committed, so the children read afterwards contain
 * at least those changes. Clients re-apply events > R (harmless: events carry full state).
 */
export async function getBoard(boardId) {
  const board = await Board.findById(boardId).populate('members.userId', MEMBER_FIELDS).lean();
  const [lists, cards] = await Promise.all([
    List.find({ boardId, archived: false }).sort({ position: 1, _id: 1 }).lean(),
    Card.find({ boardId, archived: false }).sort({ position: 1, _id: 1 }).lean(),
  ]);
  return { board: toBoardDTO(board), lists, cards, revision: board.revision };
}

/** Archived lists and cards, newest first, for the archive panel (docs/11 F9). Not live. */
export async function getArchived(boardId) {
  const [lists, cards] = await Promise.all([
    List.find({ boardId, archived: true }).sort({ updatedAt: -1, _id: -1 }).lean(),
    Card.find({ boardId, archived: true }).sort({ updatedAt: -1, _id: -1 }).lean(),
  ]);
  return { lists, cards };
}

export async function renameBoard(boardId, { title }, ctx) {
  const { board, revision } = await mutateBoard(boardId, async (session) => ({
    board: await Board.findByIdAndUpdate(boardId, { $set: { title } }, { returnDocument: 'after', session }).lean(),
  }));
  const meta = toBoardMetaDTO(board);
  publish(boardId, EVT.BOARD_UPDATED, { board: meta, revision, actorId: ctx.actorId, clientMutationId: ctx.clientMutationId });
  for (const m of board.members) publishUser(m.userId, EVT.BOARDS_CHANGED, { boardId: String(boardId), reason: 'renamed' });
  return { board: meta, revision };
}

export async function deleteBoard(boardId, user) {
  const { memberIds, large } = await inTransaction(async (session) => {
    await assertRoleInTx(boardId, user.id, 'owner', session);    // re-check inside the transaction
    const board = await Board.findById(boardId, { members: 1 }).session(session).lean();
    const cardCount = await Card.countDocuments({ boardId }).session(session);
    const isLarge = cardCount > LARGE_BOARD_CARDS;
    if (!isLarge) {
      await Comment.deleteMany({ boardId }, { session });
      await Card.deleteMany({ boardId }, { session });
      await List.deleteMany({ boardId }, { session });
    }
    // Deleting the board document makes everything vanish for everyone at once.
    await Board.deleteOne({ _id: boardId }, { session });
    return { memberIds: board.members.map((m) => String(m.userId)), large: isLarge };
  });

  if (large) await deleteBoardChildren(boardId);   // outside the transaction; orphan sweep covers a crash here

  publish(boardId, EVT.BOARD_DELETED, { boardId: String(boardId), actorName: user.name });
  for (const id of memberIds) publishUser(id, EVT.BOARDS_CHANGED, { boardId: String(boardId), reason: 'deleted' });
  return { boardId: String(boardId) };
}

/** Deletes a (deleted) board's children. Idempotent; used by large deletes and the orphan sweep. */
export async function deleteBoardChildren(boardId) {
  await Comment.deleteMany({ boardId });
  await Card.deleteMany({ boardId });
  await List.deleteMany({ boardId });
}
