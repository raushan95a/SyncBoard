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

// ---- members (docs/03 — Members)
const role = z.enum(['owner', 'editor', 'viewer']);
export const memberParams = z.strictObject({ id: objectId, userId: objectId });
export const inviteMemberSchema = z.strictObject({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  role: role.default('editor'),
  clientMutationId,
});
export const updateMemberSchema = z.strictObject({ role, clientMutationId });

// ---- labels (docs/03 — Labels). _id is optional and client-generated, so creates can be optimistic.
const labelName = z.string().trim().max(LIMITS.LABEL_NAME);
export const labelParams = z.strictObject({ id: objectId, labelId: objectId });
export const labelSchema = z.strictObject({
  _id: objectId.optional(),
  name: labelName.default(''),
  color: z.enum(LABEL_COLORS),
  clientMutationId,
});
export const updateLabelSchema = z.strictObject({
  name: labelName.optional(),
  color: z.enum(LABEL_COLORS).optional(),
  clientMutationId,
}).refine((b) => b.name !== undefined || b.color !== undefined, 'Nothing to update');

// ---- comments (docs/03 — Comments)
export const cardIdParams = z.strictObject({ cardId: objectId });
export const commentsQuery = z.strictObject({
  cursor: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(LIMITS.COMMENTS_PAGE),
});
export const createCommentSchema = z.strictObject({
  body: z.string().trim().min(1, 'Write something first').max(LIMITS.COMMENT),
  clientMutationId,
});
