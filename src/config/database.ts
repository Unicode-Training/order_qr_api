import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

mongoose.set('strictQuery', true);

const READY_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export async function connectDatabase(uri: string = env.DATABASE_URL): Promise<typeof mongoose> {
  const connection = await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  logger.info(`Đã kết nối MongoDB (db: ${connection.connection.name})`);
  return connection;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('Đã ngắt kết nối MongoDB');
}

export function getDatabaseStatus(): { state: string; connected: boolean } {
  const readyState = mongoose.connection.readyState as number;
  return {
    state: READY_STATES[readyState] ?? 'unknown',
    connected: readyState === 1,
  };
}
