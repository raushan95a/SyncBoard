import * as boards from '../services/boardService.js';
import * as lists from '../services/listService.js';
import * as cards from '../services/cardService.js';
import * as members from '../services/memberService.js';
import * as labels from '../services/labelService.js';
import * as comments from '../services/commentService.js';

/** Who did it, and the client's id for recognising its own echo (docs/04). */
const ctx = (req) => ({
  actorId: req.user.id,
  clientMutationId: req.valid.body?.clientMutationId ?? req.valid.query?.clientMutationId,
});
/** Board mutations echo the clientMutationId back (docs/03 — Conventions). */
const send = (req, res, data, status = 200) =>
  res.status(status).json({ data: { ...data, clientMutationId: ctx(req).clientMutationId } });
const created = (req, res, result) => send(req, res, result, result.replayed ? 200 : 201);

// ---- boards
export const listBoards = async (req, res) => res.json({ data: { boards: await boards.listMyBoards(req.user.id) } });
export const createBoard = async (req, res) => res.status(201).json({ data: { board: await boards.createBoard(req.user, req.valid.body) } });
export const getBoard = async (req, res) => res.json({ data: { ...(await boards.getBoard(req.boardId)), myRole: req.boardRole } });
export const renameBoard = async (req, res) => send(req, res, await boards.renameBoard(req.boardId, req.valid.body, ctx(req)));
export const deleteBoard = async (req, res) => res.json({ data: await boards.deleteBoard(req.boardId, req.user) });
export const getArchived = async (req, res) => res.json({ data: await boards.getArchived(req.boardId) });

// ---- members
export const addMember = async (req, res) => send(req, res, await members.addMember(req.boardId, req.valid.body, ctx(req)), 201);
export const updateMember = async (req, res) => send(req, res, await members.updateMemberRole(req.boardId, req.valid.params.userId, req.valid.body, ctx(req)));
export const removeMember = async (req, res) => send(req, res, await members.removeMember(req.boardId, req.valid.params.userId, ctx(req)));

// ---- labels
export const createLabel = async (req, res) => send(req, res, await labels.createLabel(req.boardId, req.valid.body, ctx(req)), 201);
export const updateLabel = async (req, res) => send(req, res, await labels.updateLabel(req.boardId, req.valid.params.labelId, req.valid.body, ctx(req)));
export const deleteLabel = async (req, res) => send(req, res, await labels.deleteLabel(req.boardId, req.valid.params.labelId, ctx(req)));

// ---- comments
export const listComments = async (req, res) => res.json({ data: await comments.listComments(req.card._id, req.valid.query) });
export const createComment = async (req, res) => send(req, res, await comments.createComment(req.card, req.valid.body, ctx(req)), 201);
export const deleteComment = async (req, res) => send(req, res, await comments.deleteComment(req.comment, ctx(req)));

// ---- lists
export const createList = async (req, res) => created(req, res, await lists.createList(req.boardId, req.valid.body, ctx(req)));
export const updateList = async (req, res) => send(req, res, await lists.updateList(req.list._id, req.boardId, req.valid.body, ctx(req)));
export const moveList = async (req, res) => send(req, res, await lists.moveList(req.list._id, req.boardId, req.valid.body, ctx(req)));
export const deleteList = async (req, res) => send(req, res, await lists.deleteList(req.list._id, req.boardId, ctx(req)));

// ---- cards
export const createCard = async (req, res) => created(req, res, await cards.createCard(req.list._id, req.boardId, req.valid.body, ctx(req)));
export const getCard = async (req, res) => res.json({ data: await cards.getCard(req.card) });
export const updateContent = async (req, res) => send(req, res, await cards.updateContent(req.card._id, req.boardId, req.valid.body, ctx(req)));
export const updateFields = async (req, res) => send(req, res, await cards.updateFields(req.card._id, req.boardId, req.valid.body, ctx(req)));
export const addAssignee = async (req, res) => send(req, res, await cards.addAssignee(req.card._id, req.boardId, req.valid.body.userId, ctx(req)));
export const removeAssignee = async (req, res) => send(req, res, await cards.removeAssignee(req.card._id, req.boardId, req.valid.params.userId, ctx(req)));
export const addLabel = async (req, res) => send(req, res, await cards.addLabel(req.card._id, req.boardId, req.valid.body.labelId, ctx(req)));
export const removeLabel = async (req, res) => send(req, res, await cards.removeLabel(req.card._id, req.boardId, req.valid.params.labelId, ctx(req)));
export const moveCard = async (req, res) => send(req, res, await cards.moveCard(req.card._id, req.boardId, req.valid.body, ctx(req)));
export const deleteCard = async (req, res) => send(req, res, await cards.deleteCard(req.card._id, req.boardId, ctx(req)));
