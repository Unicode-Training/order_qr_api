import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { swaggerSpec } from './config/swagger';
import { errorHandler, notFoundHandler, requestLogger } from './middlewares';
import apiRoutes from './routes';

function buildCorsOptions(): CorsOptions {
  const origins = env.CORS_ORIGINS;
  if (origins.length === 0 || origins.includes('*')) {
    return { origin: true, credentials: true };
  }
  return { origin: origins, credentials: true };
}

/** Tạo Express app (không listen) — dùng chung cho server.ts và test. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
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

  app.use('/api/v1', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
