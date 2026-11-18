import { Router } from 'express';
import { authenticate } from './middlewares/authenticate';
import areaRoutes from './modules/areas/area.routes';
import { createAuthRouter } from './modules/auth/auth.routes';
import healthRoutes from './modules/health/health.routes';
import categoryRoutes from './modules/menu/category.routes';
import menuItemRoutes from './modules/menu/menuItem.routes';
import publicMenuRoutes from './modules/menu/publicMenu.routes';
import { adminSettingsRouter, publicRestaurantRouter } from './modules/settings/settings.routes';
import { adminTablesRouter, publicTablesRouter } from './modules/tables/table.routes';
import uploadRoutes from './modules/uploads/upload.routes';
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
  adminRouter.use('/areas', areaRoutes);
  adminRouter.use('/tables', adminTablesRouter);
  adminRouter.use('/categories', categoryRoutes);
  adminRouter.use('/menu-items', menuItemRoutes);
  adminRouter.use('/uploads', uploadRoutes);
  router.use('/admin', adminRouter);

  const publicRouter = Router();
  publicRouter.use('/restaurant', publicRestaurantRouter);
  publicRouter.use('/tables', publicTablesRouter);
  publicRouter.use('/', publicMenuRoutes);
  router.use('/public', publicRouter);

  return router;
}
