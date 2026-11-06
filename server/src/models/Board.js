import mongoose from 'mongoose';
import { LIMITS, LABEL_COLORS } from '@syncboard/shared/limits';
import { ROLES } from '@syncboard/shared/roles';

const { Schema } = mongoose;

const boardSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: LIMITS.BOARD_TITLE },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },   // informational only
  // Permissions come ONLY from members[].role (no ownerId field). docs/02
  members: [{
    _id: false,
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, default: 'editor' },
  }],
  labels: [{
    name: { type: String, trim: true, maxlength: LIMITS.LABEL_NAME, default: '' },
    color: { type: String, enum: LABEL_COLORS, required: true },
  }],
  revision: { type: Number, default: 0 },
}, { timestamps: true });

boardSchema.index({ 'members.userId': 1 });

/** Six unnamed colored labels for every new board (docs/02). */
export const DEFAULT_LABELS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue'].map((color) => ({ name: '', color }));

export const Board = mongoose.models.Board ?? mongoose.model('Board', boardSchema);
