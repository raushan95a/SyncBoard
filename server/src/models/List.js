import mongoose from 'mongoose';
import { LIMITS } from '@syncboard/shared/limits';

const { Schema } = mongoose;

const listSchema = new Schema({
  boardId: { type: Schema.Types.ObjectId, ref: 'Board', required: true },
  title: { type: String, required: true, trim: true, maxlength: LIMITS.LIST_TITLE },
  position: { type: String, required: true },     // fractional index; sort by (position, _id)
  archived: { type: Boolean, default: false },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

listSchema.index({ boardId: 1, archived: 1, position: 1, _id: 1 });

export const List = mongoose.models.List ?? mongoose.model('List', listSchema);
