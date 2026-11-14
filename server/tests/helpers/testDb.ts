import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

// Uses an in-memory MongoDB replica set (applying a plan uses transactions, which need one).
// Set TEST_MONGO_URI to use an existing replica set instead (for example a CI service).
let memoryServer: MongoMemoryReplSet | null = null;

export async function startTestDb() {
  let uri = process.env.TEST_MONGO_URI;
  if (!uri) {
    memoryServer = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
    uri = memoryServer.getUri();
  }
  const dbName = `shiftpilot_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(uri, { dbName });
  // Build unique indexes now; idempotency tests depend on them.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
}

export async function stopTestDb() {
  await mongoose.connection.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}
