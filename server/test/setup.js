import { inject, beforeAll, afterAll } from 'vitest';

// Must run before any import of src/config/env.js, so the app sees test values.
// These override anything from a shell or .env file: tests can never reach Atlas.
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = inject('mongoUri');
process.env.MONGO_DB = 'collabboard-test';
process.env.JWT_SECRET = 'test-secret-'.padEnd(64, 'x');

if (process.env.MONGO_URI.startsWith('mongodb+srv://')) {
  throw new Error('Refusing to run tests against Atlas.');
}

const { connectDB, disconnectDB } = await import('../src/config/db.js');
const mongoose = (await import('mongoose')).default;

beforeAll(async () => {
  await connectDB(process.env.MONGO_URI, process.env.MONGO_DB);
  await mongoose.connection.dropDatabase();
});

afterAll(async () => {
  await disconnectDB();
});
