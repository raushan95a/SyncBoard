import { MongoMemoryReplSet } from 'mongodb-memory-server';

/**
 * Starts an in-memory replica set once for the whole run (transactions need a replica set).
 * Tests NEVER touch Atlas (ADR-020): setup.js overrides MONGO_URI with this URI.
 */
let replSet;

export async function setup(project) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUri', replSet.getUri());
}

export async function teardown() {
  await replSet?.stop();
}
