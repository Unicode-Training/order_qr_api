import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import * as areaController from './area.controller';
import { createAreaSchema, updateAreaSchema } from './area.schema';

/**
 * Khu vực / tầng — gắn dưới /api/v1/admin/areas (đã qua `authenticate`).
 */
const router = Router();

/**
 * @openapi
 * /admin/areas:
 *   get:
 *     tags: [Areas]
 *     summary: Danh sách khu vực (sắp theo sortOrder, name; không phân trang)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách khu vực kèm số bàn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Area' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     tags: [Areas]
 *     summary: Tạo khu vực
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AreaInput' }
 *     responses:
 *       201:
 *         description: Đã tạo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Area' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', areaController.list);
router.post('/', validate({ body: createAreaSchema }), areaController.create);

/**
 * @openapi
 * /admin/areas/{id}:
 *   parameters:
 *     - { in: path, name: id, required: true, schema: { type: string, example: 665f1c2e8b3a4d0012345678 } }
 *   get:
 *     tags: [Areas]
 *     summary: Chi tiết khu vực
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Khu vực
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Area' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Areas]
 *     summary: Cập nhật khu vực
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               name: { type: string, maxLength: 100 }
 *               sortOrder: { type: integer }
 *     responses:
 *       200:
 *         description: Đã cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Area' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Areas]
 *     summary: Xoá khu vực (chỉ khi không còn bàn)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Đã xoá, trả về khu vực vừa xoá
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Area' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Khu vực vẫn còn bàn (AREA_HAS_TABLES)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
router.get('/:id', validate({ params: idParamsSchema }), areaController.getById);
router.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateAreaSchema }),
  areaController.update,
);
router.delete('/:id', validate({ params: idParamsSchema }), areaController.remove);

export default router;
