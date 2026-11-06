/**
 * Performance seed (docs/07 Phase 7): 1 board × LISTS lists × CARDS cards per list, owned by
 * seed-perf@syncboard.local (password: password123). Then times the board snapshot load and card
 * moves through the real services (transactions included), and prints the numbers.
 *
 *   npm run seed -w server                 # seed (replacing an earlier seed) and measure
 *   npm run seed -w server -- --drop       # remove the seed user and their boards
 *   npm run seed -w server -- --lists 5 --cards 500
 *
 * Uses MONGO_URI / MONGO_DB from server/.env. Refuses to touch a *-prod database.
 */
import { performance } from 'node:perf_hooks';
import bcrypt from 'bcryptjs';
import { seed as seedKeys } from '@syncboard/shared/position';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Board, DEFAULT_LABELS } from '../src/models/Board.js';
import { List } from '../src/models/List.js';
import { Card } from '../src/models/Card.js';
import { getBoard, deleteBoardChildren } from '../src/services/boardService.js';
import { moveCard } from '../src/services/cardService.js';

const EMAIL = 'seed-perf@syncboard.local';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
};
const LISTS = arg('lists', 5);
const CARDS = arg('cards', 500);
const RUNS = arg('runs', 10);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];
const ms = (x) => Math.round(x * 10) / 10;

async function drop() {
  const user = await User.findOne({ email: EMAIL }).lean();
  if (!user) return 0;
  const boards = await Board.find({ 'members.userId': user._id }, { _id: 1 }).lean();
  for (const b of boards) {
    await deleteBoardChildren(b._id);
    await Board.deleteOne({ _id: b._id });
  }
  await User.deleteOne({ _id: user._id });
  return boards.length;
}

async function seed() {
  const user = await User.create({
    name: 'Seed Perf', email: EMAIL, passwordHash: await bcrypt.hash('password123', env.BCRYPT_COST), avatarColor: '#6366f1',
  });
  const board = await Board.create({
    title: `Perf ${LISTS}×${CARDS}`, createdBy: user._id, members: [{ userId: user._id, role: 'owner' }], labels: DEFAULT_LABELS,
  });
  const listKeys = seedKeys(LISTS);
  const lists = await List.insertMany(listKeys.map((position, i) => ({ boardId: board._id, title: `List ${i + 1}`, position, createdBy: user._id })));
  const cardKeys = seedKeys(CARDS);
  for (const list of lists) {
    await Card.insertMany(cardKeys.map((position, i) => ({
      boardId: board._id, listId: list._id, title: `${list.title} · card ${i + 1}`, position, createdBy: user._id,
      labelIds: i % 7 === 0 ? [board.labels[i % board.labels.length]._id] : [],
    })));
  }
  return { user, board, lists };
}

async function measure({ user, board, lists }) {
  const load = [];
  let snapshotCards = 0;
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const snap = await getBoard(board._id);
    load.push(performance.now() - t);
    snapshotCards = snap.cards.length;
  }
  const bytes = Buffer.byteLength(JSON.stringify(await getBoard(board._id)));

  // Moves: alternate a card between the middle of two lists (neighbor resolution + transaction).
  const moves = [];
  const ctx = { actorId: String(user._id) };
  for (let i = 0; i < RUNS * 2; i++) {
    const to = lists[(i + 1) % 2];
    const [card] = await Card.find({ listId: lists[i % 2]._id, archived: false }).sort({ position: 1, _id: 1 }).skip(CARDS / 2).limit(1).lean();
    const [before, after] = await Card.find({ listId: to._id, archived: false }).sort({ position: 1, _id: 1 }).skip(CARDS / 2 - 1).limit(2).lean();
    const t = performance.now();
    await moveCard(card._id, board._id, { toListId: to._id, beforeId: before._id, afterId: after._id }, ctx);
    moves.push(performance.now() - t);
  }
  return {
    board: String(board._id),
    cards: snapshotCards,
    snapshotKB: Math.round(bytes / 1024),
    loadMs: { median: ms(median(load)), p95: ms(p95(load)), runs: load.length },
    moveMs: { median: ms(median(moves)), p95: ms(p95(moves)), runs: moves.length },
  };
}

async function main() {
  if (/prod/i.test(env.MONGO_DB)) throw new Error(`Refusing to seed ${env.MONGO_DB}`);
  await connectDB(env.MONGO_URI, env.MONGO_DB);
  try {
    const removed = await drop();
    if (process.argv.includes('--drop')) {
      console.log(JSON.stringify({ db: env.MONGO_DB, droppedBoards: removed }));
      return;
    }
    const t = performance.now();
    const seeded = await seed();
    const seedMs = Math.round(performance.now() - t);
    const result = await measure(seeded);
    console.log(JSON.stringify({ db: env.MONGO_DB, lists: LISTS, cardsPerList: CARDS, seedMs, ...result }, null, 2));
    console.log(`Log in as ${EMAIL} / password123 to try it in the UI. Remove with: npm run seed -w server -- --drop`);
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
