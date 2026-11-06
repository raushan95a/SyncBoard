import { Router } from 'express';
import {
  idParams, boardIdParams, listIdParams, cardUserParams, cardLabelParams, mutationQuery,
  createBoardSchema, renameBoardSchema,
  createListSchema, updateListSchema, moveListSchema,
  createCardSchema, cardContentSchema, cardFieldsSchema, cardAssigneeSchema, cardLabelSchema, moveCardSchema,
} from '@syncboard/shared/schemas';
import { validate } from '../middleware/validate.js';
import { boardFromParam, loadList, loadCard, requireRole } from '../middleware/loadResource.js';
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
apiRouter.delete('/cards/:id', v({ params: idParams, query: mutationQuery }), loadCard, requireRole('editor'), c.deleteCard);
