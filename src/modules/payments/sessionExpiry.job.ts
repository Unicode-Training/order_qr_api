import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { expireEmptySessions } from './payment.service';

/** Chu kỳ quét phiên trống bị bỏ quên. */
export const EMPTY_SESSION_SWEEP_INTERVAL_MS = 5 * 60_000;

export interface EmptySessionExpiryJob {
  /** Dừng job và đợi lượt quét đang chạy (nếu có) kết thúc. */
  stop: () => Promise<void>;
}

/**
 * Job định kỳ gọi `expireEmptySessions`. Chỉ khởi động trong `server.ts` (sau khi kết nối DB),
 * không chạy trong `createApp()`. Timer `unref()` → không giữ process sống; lỗi chỉ được log;
 * lượt quét trước chưa xong thì bỏ qua lượt sau. `EMPTY_SESSION_TIMEOUT_MINUTES=0` → không chạy.
 */
export function startEmptySessionExpiryJob(
  timeoutMinutes = env.EMPTY_SESSION_TIMEOUT_MINUTES,
  intervalMs = EMPTY_SESSION_SWEEP_INTERVAL_MS,
): EmptySessionExpiryJob {
  if (timeoutMinutes <= 0) {
    logger.info('Tự đóng phiên trống: đã tắt (EMPTY_SESSION_TIMEOUT_MINUTES=0)');
    return { stop: async () => {} };
  }

  let running: Promise<void> | null = null;
  const tick = () => {
    if (running) return;
    running = expireEmptySessions(new Date(), timeoutMinutes)
      .then(() => undefined)
      .catch((err: unknown) => logger.error('Lỗi job tự đóng phiên trống', err))
      .finally(() => {
        running = null;
      });
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref();
  tick();
  logger.info(
    `Tự đóng phiên trống sau ${timeoutMinutes} phút (quét mỗi ${intervalMs / 60_000} phút)`,
  );

  return {
    stop: async () => {
      clearInterval(timer);
      await running;
    },
  };
}
