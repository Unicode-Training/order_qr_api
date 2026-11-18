import { Router } from 'express';
import { authenticate } from './middlewares/authenticate';
import { createPublicRateLimiter } from './middlewares/rateLimit';
import areaRoutes from './modules/areas/area.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import { createAuthRouter } from './modules/auth/auth.routes';
import healthRoutes from './modules/health/health.routes';
import categoryRoutes from './modules/menu/category.routes';
import menuItemRoutes from './modules/menu/menuItem.routes';
import publicMenuRoutes from './modules/menu/publicMenu.routes';
import { adminOrdersRouter, adminTableOrdersRouter } from './modules/orders/adminOrder.routes';
import {
  adminPaymentsRouter,
  adminSessionsRouter,
  adminTableBillRouter,
} from './modules/payments/payment.routes';
import { createPublicOrderRouter } from './modules/orders/publicOrder.routes';
import {
  adminServiceRequestsRouter,
  createPublicServiceRequestRouter,
} from './modules/serviceRequests/serviceRequest.routes';
import { createPublicSessionRouter } from './modules/sessions/session.routes';
import { adminSettingsRouter, publicRestaurantRouter } from './modules/settings/settings.routes';
import { adminTablesRouter, publicTablesRouter } from './modules/tables/table.routes';
import uploadRoutes from './modules/uploads/upload.routes';
import userRoutes from './modules/users/user.routes';

/**
 * Router gốc cho /api/v1 — các module mới đăng ký route tại đây.
 * - /admin/*  : bắt buộc đăng nhập (Bearer access token). Không phân quyền theo vai trò.
 * - /public/* : không cần đăng nhập (dành cho khách quét QR), có rate limit theo IP.
 *               API khách sau khi quét QR xác thực bằng header X-Session-Token.
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
  adminRouter.use('/tables', adminTableOrdersRouter);
  adminRouter.use('/tables', adminTablesRouter);
  adminRouter.use('/tables', adminTableBillRouter);
  adminRouter.use('/sessions', adminSessionsRouter);
  adminRouter.use('/payments', adminPaymentsRouter);
  adminRouter.use('/categories', categoryRoutes);
  adminRouter.use('/menu-items', menuItemRoutes);
  adminRouter.use('/uploads', uploadRoutes);
  adminRouter.use('/orders', adminOrdersRouter);
  adminRouter.use('/service-requests', adminServiceRequestsRouter);
  adminRouter.use('/dashboard', dashboardRoutes);
  router.use('/admin', adminRouter);

  const publicRouter = Router();
  publicRouter.use(createPublicRateLimiter());
  publicRouter.use('/restaurant', publicRestaurantRouter);
  publicRouter.use('/tables', publicTablesRouter);
  publicRouter.use('/sessions', createPublicSessionRouter());
  publicRouter.use('/orders', createPublicOrderRouter());
  publicRouter.use('/service-requests', createPublicServiceRequestRouter());
  publicRouter.use('/', publicMenuRoutes);
  router.use('/public', publicRouter);

  return router;
}
