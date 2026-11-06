import * as boards from '../services/boardService.js';
import * as lists from '../services/listService.js';
import * as cards from '../services/cardService.js';

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
