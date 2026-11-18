import type { Server } from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(`Server đang chạy tại http://localhost:${env.PORT} (${env.NODE_ENV})`);
    logger.info(`Swagger UI: http://localhost:${env.PORT}/api/docs`);
  });

  const shutdown = (signal: string) => {
    logger.info(`Nhận ${signal}, đang tắt server...`);
    server.close(() => {
      disconnectDatabase()
        .catch((err: unknown) => logger.error('Lỗi khi ngắt kết nối DB', err))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err: unknown) => {
  logger.error('Không thể khởi động server', err);
  process.exit(1);
});
