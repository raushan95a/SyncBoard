import mongoose from 'mongoose';
import { Board } from '../models/Board.js';
import { List } from '../models/List.js';
import { Card } from '../models/Card.js';
import { Comment } from '../models/Comment.js';
import { deleteBoardChildren } from './boardService.js';

/**
 * Deletes lists, cards, and comments whose board no longer exists (ADR-019).
 * They're left behind if the process crashes during a large board's batched delete.
 * Idempotent; run on every boot without blocking `listen`.
 * @returns {Promise<number>} number of orphaned boards cleaned
 */
export async function sweepOrphans() {
  const ids = new Map();
  for (const Model of [List, Card, Comment]) {
    for (const id of await Model.distinct('boardId')) ids.set(String(id), id);
  }
  if (!ids.size) return 0;
  const alive = await Board.find({ _id: mongoose.trusted({ $in: [...ids.values()] }) }).distinct('_id');
  for (const id of alive) ids.delete(String(id));
  for (const id of ids.values()) await deleteBoardChildren(id);
  return ids.size;
}
