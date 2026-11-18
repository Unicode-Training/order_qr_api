import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env, isProduction } from './config/env';
import { swaggerSpec } from './config/swagger';
import { errorHandler, notFoundHandler, requestLogger } from './middlewares';
import { sanitizeRequest } from './middlewares/sanitize';
import { createApiRouter } from './routes';
import { logger } from './utils/logger';

/** Giới hạn kích thước body JSON / form (ảnh upload đi qua multer với giới hạn riêng 5MB). */
export const BODY_LIMIT = '100kb';

/** Header phía frontend cần đọc được qua CORS (rate limit, tải file QR). */
const EXPOSED_HEADERS = ['RateLimit', 'RateLimit-Policy', 'Retry-After', 'Content-Disposition'];

/**
 * CORS theo CORS_ORIGINS (phân tách dấu phẩy):
 * - rỗng hoặc `*`: cho phép mọi origin (chỉ nên dùng khi dev; production sẽ log cảnh báo);
 * - danh sách: chỉ các origin khớp chính xác; origin lạ không nhận header Access-Control-*
 *   (trình duyệt tự chặn) — request không có Origin (curl, server-to-server) vẫn đi qua.
 */
export function buildCorsOptions(origins: readonly string[] = env.CORS_ORIGINS): CorsOptions {
  const base: CorsOptions = {
    credentials: true,
    exposedHeaders: EXPOSED_HEADERS,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
    maxAge: 600,
  };
  if (origins.length === 0 || origins.includes('*')) {
    if (isProduction) logger.warn('CORS_ORIGINS trống hoặc "*" — đang cho phép mọi origin');
    return { ...base, origin: true };
  }
  const allowed = new Set(origins.map((origin) => origin.replace(/\/+$/, '')));
  return {
    ...base,
    origin: (origin, callback) => callback(null, !origin || allowed.has(origin)),
  };
}

/** Tạo Express app (không listen) — dùng chung cho server.ts và test. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Ảnh QR (PNG/SVG) được frontend ở origin khác nhúng bằng <img>.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT, parameterLimit: 100 }));
  app.use(sanitizeRequest);
  app.use(requestLogger);

  app.get('/api/docs.json', (_req, res) => {
    res.json(swaggerSpec);
  });
  // Swagger UI dùng inline script nên nới CSP chỉ cho route này.
  app.use(
    '/api/docs',
    helmet({ contentSecurityPolicy: false }),
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, { customSiteTitle: 'Order QR API Docs' }),
  );

  app.use('/api/v1', createApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
