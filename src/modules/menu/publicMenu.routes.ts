import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import * as menuController from './menu.controller';
import { publicMenuItemParamsSchema, publicMenuQuerySchema } from './menu.schema';

/** Thực đơn cho khách — gắn dưới /api/v1/public (không cần đăng nhập). */
const router = Router();

/**
 * @openapi
 * /public/menu:
 *   get:
 *     tags: [Menu]
 *     summary: Thực đơn cho khách
 *     description: |
 *       Danh mục đang hiện (theo sortOrder) kèm món đang hiện (theo sortOrder).
 *       Món hết hàng vẫn được trả về với `isAvailable=false`. Món/danh mục bị ẩn không xuất hiện.
 *       Khi có `search`/`tag`, danh mục không có món phù hợp bị bỏ.
 *     parameters:
 *       - { in: query, name: search, description: Tìm theo tên món (có/không dấu), schema: { type: string } }
 *       - { in: query, name: category, description: id hoặc slug danh mục, schema: { type: string } }
 *       - { in: query, name: tag, schema: { type: string, enum: [bestseller, new, spicy, vegetarian, chef_recommend] } }
 *     responses:
 *       200:
 *         description: Thực đơn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/PublicMenu' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/menu', validate({ query: publicMenuQuerySchema }), menuController.getPublicMenu);

/**
 * @openapi
 * /public/menu-items/{id}:
 *   get:
 *     tags: [Menu]
 *     summary: Chi tiết món cho khách
 *     description: '`id` là id hoặc slug của món. Món hoặc danh mục đang ẩn → 404.'
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Món
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   allOf:
 *                     - { $ref: '#/components/schemas/PublicMenuItem' }
 *                     - type: object
 *                       properties: { category: { $ref: '#/components/schemas/PublicCategory' } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/menu-items/:id',
  validate({ params: publicMenuItemParamsSchema }),
  menuController.getPublicMenuItem,
);

export default router;
