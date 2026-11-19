import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorHandler, notFoundHandler, requestLogger } from './middlewares';
import { sanitizeRequest } from './middlewares/sanitize';
import { createApiRouter } from './routes';

/** Giới hạn kích thước body JSON / form (ảnh upload đi qua multer với giới hạn riêng 5MB). */
export const BODY_LIMIT = '100kb';

/** Header phía frontend cần đọc được qua CORS (rate limit, tải file QR). */
const EXPOSED_HEADERS = ['RateLimit', 'RateLimit-Policy', 'Retry-After', 'Content-Disposition'];

/**
 * CORS mở cho mọi origin (dự án học tập, không ràng buộc domain): phản chiếu Origin của
 * request (`origin: true`) để vẫn dùng được `credentials`.
 */
export function buildCorsOptions(): CorsOptions {
  return {
    origin: true,
    credentials: true,
    exposedHeaders: EXPOSED_HEADERS,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
    maxAge: 600,
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
