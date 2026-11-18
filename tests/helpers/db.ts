import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

let mongod: MongoMemoryServer | undefined;

export async function connectTestDb(): Promise<void> {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: 'order-qr-test' });
}

export async function clearTestDb(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

export async function closeTestDb(): Promise<void> {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = undefined;
  }
}

/**
 * Gọi trong file test (ở cấp describe hoặc top-level) để có MongoDB in-memory:
 * khởi động trước toàn bộ test, xoá dữ liệu sau mỗi test, tắt khi xong.
 */
export function setupTestDb(): void {
  beforeAll(connectTestDb);
  afterEach(clearTestDb);
  afterAll(closeTestDb);
}
