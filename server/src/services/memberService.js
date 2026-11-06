import mongoose from 'mongoose';
import { EVT } from '@syncboard/shared/events';
import { LIMITS } from '@syncboard/shared/limits';
import { Board } from '../models/Board.js';
import { Card } from '../models/Card.js';
import { User } from '../models/User.js';
import { mutateBoard } from './mutateBoard.js';
import { assertRoleInTx } from '../middleware/loadResource.js';
import { publish, publishUser, evictFromBoard } from '../sockets/publisher.js';
import { toMemberDTO } from './dto.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Members and roles (docs/03 — Members, docs/11 F12). Permissions come only from members[].role,
 * and a board must always keep at least one owner. Every rule is checked INSIDE the transaction,
 * so two owners demoting each other at once can't leave the board ownerless.
 */
const meta = (ctx, revision) => ({ revision, actorId: ctx.actorId, clientMutationId: ctx.clientMutationId });
const oid = (id) => new mongoose.Types.ObjectId(String(id));

async function membersOf(boardId, session) {
  const board = await Board.findById(boardId, { members: 1 }).session(session).lean();
  if (!board) throw new ApiError(404, 'NOT_FOUND');
  return board.members;
}
const ownerCount = (members) => members.filter((m) => m.role === 'owner').length;
const findMember = (members, userId) => members.find((m) => String(m.userId) === String(userId));

export async function addMember(boardId, { email, role }, ctx) {
  const user = await User.findOne({ email }).lean();
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'No account with that email');

  const { revision } = await mutateBoard(boardId, async (session) => {
    await assertRoleInTx(boardId, ctx.actorId, 'owner', session);
    const members = await membersOf(boardId, session);
    if (findMember(members, user._id)) throw new ApiError(409, 'CONFLICT', 'Already a member of this board');
    if (members.length >= LIMITS.MEMBERS_PER_BOARD) {
      throw new ApiError(422, 'LIMIT_REACHED', `A board can have at most ${LIMITS.MEMBERS_PER_BOARD} members`);
    }
    await Board.updateOne({ _id: boardId }, { $push: { members: { userId: user._id, role } } }, { session });
    return {};
  });

  const member = toMemberDTO(user, role);
  publish(boardId, EVT.MEMBER_ADDED, { member, ...meta(ctx, revision) });
  publishUser(user._id, EVT.BOARDS_CHANGED, { boardId: String(boardId), reason: 'added' });
  return { member, revision };
}

export async function updateMemberRole(boardId, userId, { role }, ctx) {
  const { revision } = await mutateBoard(boardId, async (session) => {
    await assertRoleInTx(boardId, ctx.actorId, 'owner', session);
    const members = await membersOf(boardId, session);
    const target = findMember(members, userId);
    if (!target) throw new ApiError(404, 'NOT_FOUND');
    if (target.role === 'owner' && role !== 'owner' && ownerCount(members) === 1) {
      throw new ApiError(422, 'LAST_OWNER', 'A board needs at least one owner. Make someone else an owner first.');
    }
    await Board.updateOne({ _id: boardId, 'members.userId': oid(userId) }, { $set: { 'members.$.role': role } }, { session });
    return {};
  });

  const user = await User.findById(userId).lean();
  const member = toMemberDTO(user ?? { _id: userId }, role);
  publish(boardId, EVT.MEMBER_UPDATED, { member, ...meta(ctx, revision) });
  return { member, revision };
}

/**
 * Remove a member, or leave (userId = self). Owners may remove anyone; anyone may remove
 * themselves. The user is unassigned from every card of the board in the same transaction.
 */
export async function removeMember(boardId, userId, ctx) {
  const self = String(userId) === String(ctx.actorId);
  const { revision } = await mutateBoard(boardId, async (session) => {
    await assertRoleInTx(boardId, ctx.actorId, self ? 'viewer' : 'owner', session);
    const members = await membersOf(boardId, session);
    const target = findMember(members, userId);
    if (!target) throw new ApiError(404, 'NOT_FOUND');
    if (target.role === 'owner' && ownerCount(members) === 1) {
      throw new ApiError(422, 'LAST_OWNER', self
        ? 'You are the last owner. Make someone else an owner before leaving.'
        : 'A board needs at least one owner.');
    }
    await Board.updateOne({ _id: boardId }, { $pull: { members: { userId: oid(userId) } } }, { session });
    await Card.updateMany({ boardId, assigneeIds: oid(userId) }, { $pull: { assigneeIds: oid(userId) } }, { session });
    return {};
  });

  // After the commit: tell the room, then cut the removed user off (docs/04).
  publish(boardId, EVT.MEMBER_REMOVED, { userId: String(userId), ...meta(ctx, revision) });
  publishUser(userId, EVT.ACCESS_REVOKED, { boardId: String(boardId) });
  publishUser(userId, EVT.BOARDS_CHANGED, { boardId: String(boardId), reason: 'removed' });
  evictFromBoard(userId, boardId);
  return { userId: String(userId), revision };
}
