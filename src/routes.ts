import { Router } from 'express';
import healthRoutes from './modules/health/health.routes';

/** Router gốc cho /api/v1 — các module mới đăng ký route tại đây. */
const router = Router();

router.use('/health', healthRoutes);

export default router;
