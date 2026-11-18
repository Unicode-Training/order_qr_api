import { Router } from 'express';
import { getHealth } from './health.controller';

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Kiểm tra trạng thái API và kết nối cơ sở dữ liệu
 *     responses:
 *       200:
 *         description: API và DB hoạt động bình thường
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     status: { type: string, example: ok }
 *                     uptime: { type: integer, example: 12 }
 *                     timestamp: { type: string, format: date-time }
 *                     database:
 *                       type: object
 *                       properties:
 *                         state: { type: string, example: connected }
 *                         connected: { type: boolean, example: true }
 *       503:
 *         description: Mất kết nối cơ sở dữ liệu
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/', getHealth);

export default router;
