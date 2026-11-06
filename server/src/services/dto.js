/**
 * Shapes sent to clients (REST responses and socket events). Plain JSON: ObjectIds and
 * Dates become strings when serialized, so clients compare ids as strings.
 */

/** @param {any} board  lean board with members.userId populated (name, email, avatarColor) */
export function toBoardDTO(board) {
  return {
    _id: String(board._id),
    title: board.title,
    labels: (board.labels ?? []).map((l) => ({ _id: String(l._id), name: l.name, color: l.color })),
    members: (board.members ?? [])
      .filter((m) => m.userId)                       // a deleted user's populated ref is null
      .map((m) => {
        const u = m.userId;
        const populated = typeof u === 'object' && 'name' in u;
        return populated
          ? { userId: String(u._id), role: m.role, name: u.name, email: u.email, avatarColor: u.avatarColor }
          : { userId: String(u), role: m.role };
      }),
    revision: board.revision,
    updatedAt: board.updatedAt,
  };
}

/** The part of a board that `board:updated` carries (title and labels). */
export const toBoardMetaDTO = (board) => ({
  _id: String(board._id),
  title: board.title,
  labels: (board.labels ?? []).map((l) => ({ _id: String(l._id), name: l.name, color: l.color })),
});

/** One member as `member:added` / `member:updated` carry it (user fields included). */
export const toMemberDTO = (user, role) => ({
  userId: String(user._id), role, name: user.name, email: user.email, avatarColor: user.avatarColor,
});

/** A comment with its author's display fields. `authorId` populated → author; a deleted user → null. */
export function toCommentDTO(c) {
  const a = c.authorId;
  const populated = a && typeof a === 'object' && 'name' in a;
  return {
    _id: String(c._id),
    cardId: String(c.cardId),
    boardId: String(c.boardId),
    authorId: populated ? String(a._id) : (a ? String(a) : null),
    author: populated ? { _id: String(a._id), name: a.name, avatarColor: a.avatarColor } : null,
    body: c.body,
    createdAt: c.createdAt,
  };
}
