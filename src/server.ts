import type { Server } from 'node:http';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { startEmptySessionExpiryJob } from './modules/payments/sessionExpiry.job';
import { createShutdownHandler, registerShutdownSignals } from './utils/gracefulShutdown';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  await connectDatabase();
  const expiryJob = startEmptySessionExpiryJob();

  const app = createApp();
  const server: Server = app.listen(env.PORT, () => {
    logger.info(`Server đang chạy tại http://localhost:${env.PORT} (${env.NODE_ENV})`);
    logger.info(`Swagger UI: http://localhost:${env.PORT}/api/docs`);
  });
  // Keep-alive dài hơn load balancer (thường 60s) để tránh lỗi 502 do LB dùng lại socket đã đóng.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  registerShutdownSignals(
    createShutdownHandler({
      server,
      onClose: async () => {
        await expiryJob.stop();
        await disconnectDatabase();
      },
    }),
  );
}

bootstrap().catch((err: unknown) => {
  logger.error('Không thể khởi động server', err);
  process.exit(1);
});
