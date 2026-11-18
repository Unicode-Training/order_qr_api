import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

/**
 * Giới hạn số lần đăng nhập THẤT BẠI theo IP (đăng nhập thành công không bị tính).
 * Tạo mới theo mỗi app instance (xem createAuthRouter) để store không bị chia sẻ giữa các test.
 */
export function createLoginRateLimiter() {
  const windowMs = env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  return rateLimit({
    windowMs,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      // Header Retry-After / RateLimit đã được express-rate-limit gắn sẵn.
      next(AppError.tooManyRequests('Đăng nhập sai quá nhiều lần, vui lòng thử lại sau'));
    },
  });
}
