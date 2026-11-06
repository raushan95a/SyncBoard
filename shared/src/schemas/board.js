import { z } from 'zod';
import { LIMITS, LABEL_COLORS } from '../limits.js';
import { objectId, clientMutationId } from './common.js';

const title = (max) => z.string().trim().min(1, 'Title is required').max(max);

// ---- params
export const idParams = z.strictObject({ id: objectId });
export const boardIdParams = z.strictObject({ boardId: objectId });
export const listIdParams = z.strictObject({ listId: objectId });
export const cardUserParams = z.strictObject({ id: objectId, userId: objectId });
export const cardLabelParams = z.strictObject({ id: objectId, labelId: objectId });

// ---- boards
export const createBoardSchema = z.strictObject({
  title: title(LIMITS.BOARD_TITLE),
  template: z.enum(['basic', 'empty']).default('basic'),
});
export const renameBoardSchema = z.strictObject({
  title: title(LIMITS.BOARD_TITLE),
  clientMutationId,
});

// ---- lists
export const createListSchema = z.strictObject({
  _id: objectId.optional(),
  title: title(LIMITS.LIST_TITLE),
  clientMutationId,
});
export const updateListSchema = z.strictObject({
  title: title(LIMITS.LIST_TITLE).optional(),
  archived: z.boolean().optional(),
  clientMutationId,
}).refine((b) => b.title !== undefined || b.archived !== undefined, 'Nothing to update');

// ---- cards
export const createCardSchema = z.strictObject({
  _id: objectId.optional(),
  title: title(LIMITS.CARD_TITLE),
  clientMutationId,
});
/** Compare-and-set on `version` (ADR-005). */
export const cardContentSchema = z.strictObject({
  title: title(LIMITS.CARD_TITLE).optional(),
  description: z.string().max(LIMITS.DESCRIPTION).optional(),
  version: z.number().int().min(0),
  clientMutationId,
}).refine((b) => b.title !== undefined || b.description !== undefined, 'Nothing to update');
/** Last-write-wins fields. dueDate: ISO date-time string (UTC) or null to clear. */
export const cardFieldsSchema = z.strictObject({
  completed: z.boolean().optional(),
  dueDate: z.iso.datetime({ offset: true }).nullable().optional(),
  archived: z.boolean().optional(),
  clientMutationId,
}).refine((b) => b.completed !== undefined || b.dueDate !== undefined || b.archived !== undefined, 'Nothing to update');
export const cardAssigneeSchema = z.strictObject({ userId: objectId, clientMutationId });
export const cardLabelSchema = z.strictObject({ labelId: objectId, clientMutationId });
/**
 * Moves (docs/03 — Move Semantics). beforeId = the item ABOVE the drop point, afterId = the
 * item BELOW it, as the user saw the list. Either may be null/omitted (start/end).
 */
const neighbors = {
  beforeId: objectId.nullable().optional(),
  afterId: objectId.nullable().optional(),
  clientMutationId,
};
export const moveCardSchema = z.strictObject({ toListId: objectId, ...neighbors });
export const moveListSchema = z.strictObject(neighbors);
/** For body-less DELETEs that still want to pass a clientMutationId via the query string. */
export const mutationQuery = z.strictObject({ clientMutationId });

// ---- labels (Phase 6 routes; schema shared now)
export const labelSchema = z.strictObject({
  name: z.string().trim().max(LIMITS.LABEL_NAME).default(''),
  color: z.enum(LABEL_COLORS),
});
