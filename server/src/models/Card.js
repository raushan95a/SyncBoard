import mongoose from 'mongoose';
import { LIMITS } from '@syncboard/shared/limits';

const { Schema } = mongoose;

const cardSchema = new Schema({
  boardId: { type: Schema.Types.ObjectId, ref: 'Board', required: true },   // denormalized; never changes
  listId: { type: Schema.Types.ObjectId, ref: 'List', required: true },
  title: { type: String, required: true, trim: true, maxlength: LIMITS.CARD_TITLE },
  description: { type: String, default: '', maxlength: LIMITS.DESCRIPTION },
  position: { type: String, required: true },
  version: { type: Number, default: 0 },          // bumps ONLY on title/description (ADR-005)
  assigneeIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  labelIds: [{ type: Schema.Types.ObjectId }],    // → board.labels._id
  dueDate: { type: Date, default: null },
  completed: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  commentCount: { type: Number, default: 0 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

cardSchema.index({ listId: 1, archived: 1, position: 1, _id: 1 });   // render a column, find neighbors
cardSchema.index({ boardId: 1, archived: 1 });                        // load a board, archived items

export const Card = mongoose.models.Card ?? mongoose.model('Card', cardSchema);
