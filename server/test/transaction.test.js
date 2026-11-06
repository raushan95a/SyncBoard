import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';

const Thing = mongoose.models.Thing ?? mongoose.model('Thing', new mongoose.Schema({ n: Number }));

describe('replica-set transactions (required by mutateBoard)', () => {
  it('commits all writes together', async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Thing.create([{ n: 1 }], { session });
        await Thing.create([{ n: 2 }], { session });
      });
    } finally {
      await session.endSession();
    }
    // sanitizeFilter is on (docs/06): server-built operator filters must be marked trusted.
    expect(await Thing.countDocuments({ n: mongoose.trusted({ $in: [1, 2] }) })).toBe(2);
  });

  it('rolls back every write when the work throws', async () => {
    const session = await mongoose.startSession();
    await expect(session.withTransaction(async () => {
      await Thing.create([{ n: 99 }], { session });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    await session.endSession();
    expect(await Thing.countDocuments({ n: 99 })).toBe(0);
  });
});
