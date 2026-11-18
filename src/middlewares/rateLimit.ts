import type { Request, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export interface RateLimiterOptions {
  windowMs: number;
  limit: number;
  /** Mặc định theo IP (IPv6 gom theo subnet /56). */
  keyGenerator?: (req: Request) => string;
  message?: string;
}

/** Tạo rate limiter trả lỗi 429 theo định dạng chung (kèm header RateLimit / Retry-After). */
export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: options.keyGenerator ?? ((req) => ipKeyGenerator(req.ip ?? '')),
    handler: (_req, _res, next) => {
      next(AppError.tooManyRequests(options.message));
    },
  });
}

const publicWindowMs = () => env.PUBLIC_RATE_LIMIT_WINDOW_SECONDS * 1000;

/** Giới hạn chung cho mọi route /public theo IP. */
export function createPublicRateLimiter(): RequestHandler {
  return createRateLimiter({ windowMs: publicWindowMs(), limit: env.PUBLIC_RATE_LIMIT_MAX });
}

/**
 * Giới hạn thao tác ghi của khách. Đặt SAU `requireGuestSession` để đếm theo phiên bàn
 * (khách cùng Wi-Fi không ảnh hưởng nhau); nếu chưa có phiên thì đếm theo IP.
 */
export function createPublicWriteRateLimiter(): RequestHandler {
  return createRateLimiter({
    windowMs: publicWindowMs(),
    limit: env.PUBLIC_WRITE_RATE_LIMIT_MAX,
    keyGenerator: (req) =>
      req.guestSession ? `session:${req.guestSession.id}` : `ip:${ipKeyGenerator(req.ip ?? '')}`,
    message: 'Thao tác quá nhanh, vui lòng thử lại sau ít phút',
  });
}
