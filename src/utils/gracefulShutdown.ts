import type { Server } from 'node:http';
import { logger } from './logger';

export interface GracefulShutdownOptions {
  server: Server;
  /** Dọn dẹp sau khi server ngừng nhận request (vd. ngắt kết nối DB). */
  onClose: () => Promise<void>;
  /** Hết thời gian chờ request đang chạy → buộc thoát với mã 1. */
  timeoutMs?: number;
  exit?: (code: number) => void;
}

/**
 * Tắt server an toàn:
 * 1. Ngừng nhận kết nối mới (`server.close`), đóng ngay các kết nối keep-alive đang rảnh;
 * 2. Đợi request đang xử lý xong (tối đa `timeoutMs`, sau đó đóng cưỡng bức mọi kết nối và thoát 1);
 * 3. Chạy `onClose` (ngắt DB) rồi thoát 0 (hoặc 1 nếu dọn dẹp lỗi / lý do tắt là lỗi).
 * Gọi lần 2 (nhấn Ctrl+C lần nữa) được bỏ qua — chỉ tắt một lần.
 */
export function createShutdownHandler(options: GracefulShutdownOptions) {
  const { server, onClose, timeoutMs = 10_000, exit = (code) => process.exit(code) } = options;
  let shuttingDown = false;

  return function shutdown(reason: string, exitCode = 0): void {
    if (shuttingDown) {
      logger.warn(`Đang tắt server, bỏ qua ${reason}`);
      return;
    }
    shuttingDown = true;
    logger.info(`Nhận ${reason}, đang tắt server...`);

    const timer = setTimeout(() => {
      logger.error(`Quá ${timeoutMs}ms vẫn còn request chưa xong — buộc tắt`);
      server.closeAllConnections();
      exit(1);
    }, timeoutMs);
    timer.unref();

    server.close((closeErr) => {
      if (closeErr) logger.error('Lỗi khi đóng HTTP server', closeErr);
      onClose()
        .then(() => {
          clearTimeout(timer);
          exit(closeErr ? 1 : exitCode);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          logger.error('Lỗi khi dọn dẹp lúc tắt server', err);
          exit(1);
        });
    });
    server.closeIdleConnections();
  };
}

/** Đăng ký SIGINT/SIGTERM và lỗi không bắt được (unhandledRejection/uncaughtException → tắt với mã 1). */
export function registerShutdownSignals(shutdown: (reason: string, exitCode?: number) => void) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason);
    shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', err);
    shutdown('uncaughtException', 1);
  });
}
