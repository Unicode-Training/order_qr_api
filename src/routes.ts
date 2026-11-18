import { Router } from 'express';
import { authenticate } from './middlewares/authenticate';
import { createAuthRouter } from './modules/auth/auth.routes';
import healthRoutes from './modules/health/health.routes';
import { adminSettingsRouter, publicRestaurantRouter } from './modules/settings/settings.routes';
import userRoutes from './modules/users/user.routes';

/**
 * Router gốc cho /api/v1 — các module mới đăng ký route tại đây.
 * - /admin/*  : bắt buộc đăng nhập (Bearer access token). Không phân quyền theo vai trò.
 * - /public/* : không cần đăng nhập (dành cho khách quét QR).
 * Tạo bằng factory để mỗi app instance có state riêng (vd. rate limiter).
 */
export function createApiRouter(): Router {
  const router = Router();

  router.use('/health', healthRoutes);
  router.use('/auth', createAuthRouter());

  const adminRouter = Router();
  adminRouter.use(authenticate);
  adminRouter.use('/users', userRoutes);
  adminRouter.use('/settings', adminSettingsRouter);
  router.use('/admin', adminRouter);

  const publicRouter = Router();
  publicRouter.use('/restaurant', publicRestaurantRouter);
  router.use('/public', publicRouter);

  return router;
}
