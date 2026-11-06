import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/globalSetup.js'],
    setupFiles: ['./test/setup.js'],
    // One in-memory replica set is shared; keep files sequential so DB state is predictable.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,      // first run downloads the mongod binary
  },
});
