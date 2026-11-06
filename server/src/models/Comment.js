import mongoose from 'mongoose';
import { LIMITS } from '@syncboard/shared/limits';

const { Schema } = mongoose;

const commentSchema = new Schema({
  cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
  boardId: { type: Schema.Types.ObjectId, ref: 'Board', required: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, maxlength: LIMITS.COMMENT },
}, { timestamps: true, versionKey: false });

commentSchema.index({ cardId: 1, _id: -1 });   // newest-first cursor pagination
commentSchema.index({ boardId: 1 });           // cascades + orphan sweep

export const Comment = mongoose.models.Comment ?? mongoose.model('Comment', commentSchema);
