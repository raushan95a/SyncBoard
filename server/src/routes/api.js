import { Router } from 'express';
import {
  idParams, boardIdParams, listIdParams, cardUserParams, cardLabelParams, mutationQuery,
  createBoardSchema, renameBoardSchema,
  createListSchema, updateListSchema, moveListSchema,
  createCardSchema, cardContentSchema, cardFieldsSchema, cardAssigneeSchema, cardLabelSchema, moveCardSchema,
  memberParams, inviteMemberSchema, updateMemberSchema,
  labelParams, labelSchema, updateLabelSchema,
  cardIdParams, commentsQuery, createCommentSchema,
} from '@syncboard/shared/schemas';
import { validate } from '../middleware/validate.js';
import { boardFromParam, loadList, loadCard, loadComment, requireRole, requireCommentDelete } from '../middleware/loadResource.js';
import * as c from '../controllers/boardController.js';

/**
 * Every route: validate → load resource (resolves req.boardId from the DB) → requireRole → controller.
 * Non-members get 404 everywhere; viewers get 403 on every mutation (docs/06).
 */
export const apiRouter = Router();
const v = validate;

// ---- boards
apiRouter.get('/boards', c.listBoards);
apiRouter.post('/boards', v({ body: createBoardSchema }), c.createBoard);
apiRouter.get('/boards/:id', v({ params: idParams }), boardFromParam('id'), requireRole('viewer'), c.getBoard);
apiRouter.patch('/boards/:id', v({ params: idParams, body: renameBoardSchema }), boardFromParam('id'), requireRole('owner'), c.renameBoard);
apiRouter.delete('/boards/:id', v({ params: idParams }), boardFromParam('id'), requireRole('owner'), c.deleteBoard);
apiRouter.get('/boards/:id/archived', v({ params: idParams }), boardFromParam('id'), requireRole('viewer'), c.getArchived);

// ---- members (removing yourself = leaving: any member; everything else: owner)
apiRouter.post('/boards/:id/members', v({ params: idParams, body: inviteMemberSchema }), boardFromParam('id'), requireRole('owner'), c.addMember);
apiRouter.patch('/boards/:id/members/:userId', v({ params: memberParams, body: updateMemberSchema }), boardFromParam('id'), requireRole('owner'), c.updateMember);
apiRouter.delete('/boards/:id/members/:userId', v({ params: memberParams, query: mutationQuery }), boardFromParam('id'), requireRole('viewer'), c.removeMember);

// ---- labels
apiRouter.post('/boards/:id/labels', v({ params: idParams, body: labelSchema }), boardFromParam('id'), requireRole('editor'), c.createLabel);
apiRouter.patch('/boards/:id/labels/:labelId', v({ params: labelParams, body: updateLabelSchema }), boardFromParam('id'), requireRole('editor'), c.updateLabel);
apiRouter.delete('/boards/:id/labels/:labelId', v({ params: labelParams, query: mutationQuery }), boardFromParam('id'), requireRole('editor'), c.deleteLabel);

// ---- lists
apiRouter.post('/boards/:boardId/lists', v({ params: boardIdParams, body: createListSchema }), boardFromParam('boardId'), requireRole('editor'), c.createList);
apiRouter.patch('/lists/:id', v({ params: idParams, body: updateListSchema }), loadList, requireRole('editor'), c.updateList);
apiRouter.patch('/lists/:id/move', v({ params: idParams, body: moveListSchema }), loadList, requireRole('editor'), c.moveList);
apiRouter.delete('/lists/:id', v({ params: idParams, query: mutationQuery }), loadList, requireRole('editor'), c.deleteList);

// ---- cards
apiRouter.post('/lists/:listId/cards', v({ params: listIdParams, body: createCardSchema }), loadList, requireRole('editor'), c.createCard);
apiRouter.get('/cards/:id', v({ params: idParams }), loadCard, requireRole('viewer'), c.getCard);
apiRouter.patch('/cards/:id/content', v({ params: idParams, body: cardContentSchema }), loadCard, requireRole('editor'), c.updateContent);
apiRouter.patch('/cards/:id', v({ params: idParams, body: cardFieldsSchema }), loadCard, requireRole('editor'), c.updateFields);
apiRouter.post('/cards/:id/assignees', v({ params: idParams, body: cardAssigneeSchema }), loadCard, requireRole('editor'), c.addAssignee);
apiRouter.delete('/cards/:id/assignees/:userId', v({ params: cardUserParams, query: mutationQuery }), loadCard, requireRole('editor'), c.removeAssignee);
apiRouter.post('/cards/:id/labels', v({ params: idParams, body: cardLabelSchema }), loadCard, requireRole('editor'), c.addLabel);
apiRouter.delete('/cards/:id/labels/:labelId', v({ params: cardLabelParams, query: mutationQuery }), loadCard, requireRole('editor'), c.removeLabel);
apiRouter.patch('/cards/:id/move', v({ params: idParams, body: moveCardSchema }), loadCard, requireRole('editor'), c.moveCard);
apiRouter.get('/cards/:cardId/comments', v({ params: cardIdParams, query: commentsQuery }), loadCard, requireRole('viewer'), c.listComments);
apiRouter.post('/cards/:cardId/comments', v({ params: cardIdParams, body: createCommentSchema }), loadCard, requireRole('editor'), c.createComment);
apiRouter.delete('/comments/:id', v({ params: idParams, query: mutationQuery }), loadComment, requireRole('viewer'), requireCommentDelete, c.deleteComment);
apiRouter.delete('/cards/:id', v({ params: idParams, query: mutationQuery }), loadCard, requireRole('editor'), c.deleteCard);
