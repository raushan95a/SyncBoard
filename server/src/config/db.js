import mongoose from 'mongoose';

// Wrap `$` operators found in user-supplied filter values (replaces express-mongo-sanitize,
// which doesn't work with Express 5). See docs/06.
mongoose.set('sanitizeFilter', true);
mongoose.set('strictQuery', true);

/**
 * @param {string} uri
 * @param {string} dbName  collabboard-dev | collabboard-prod (ADR-020)
 */
export async function connectDB(uri, dbName) {
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}

export const isDbUp = () => mongoose.connection.readyState === 1;
