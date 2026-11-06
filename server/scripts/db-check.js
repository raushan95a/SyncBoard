/**
 * Phase 0 check: connects to the Atlas cluster from server/.env and runs a real
 * multi-document transaction, proving the cluster is a replica set (ADR-010, ADR-020).
 * Uses a scratch collection that it drops afterwards.
 *
 *   npm run db:check -w server
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { connectDB, disconnectDB } from '../src/config/db.js';

const COLL = '_dbcheck';

try {
  const conn = await connectDB(env.MONGO_URI, env.MONGO_DB);
  const hello = await conn.db.admin().command({ hello: 1 });
  console.log(`connected: db=${env.MONGO_DB} replicaSet=${hello.setName ?? '(none)'}`);
  if (!hello.setName) throw new Error('Not a replica set: transactions will not work.');

  const coll = conn.db.collection(COLL);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await coll.insertOne({ a: 1, at: new Date() }, { session });
      await coll.insertOne({ b: 2, at: new Date() }, { session });
    });
  } finally {
    await session.endSession();
  }
  const count = await coll.countDocuments();
  await coll.drop().catch(() => {});
  if (count !== 2) throw new Error(`Expected 2 documents after the transaction, found ${count}`);
  console.log('transaction: ok');
  await disconnectDB();
} catch (err) {
  console.error('db check FAILED:', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
}
