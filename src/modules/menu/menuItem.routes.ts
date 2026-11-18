import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import * as menuController from './menu.controller';
import {
  availabilitySchema,
  createMenuItemSchema,
  listMenuItemsQuerySchema,
  reorderSchema,
  updateMenuItemSchema,
} from './menu.schema';

/** Món ăn — gắn dưới /api/v1/admin/menu-items (đã qua `authenticate`). */
const router = Router();

/**
 * @openapi
 * /admin/menu-items:
 *   get:
 *     tags: [MenuItems]
 *     summary: Danh sách món (lọc, tìm kiếm, phân trang)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - in: query
 *         name: sort
 *         description: 'Trường sort: sortOrder, name, price, createdAt, updatedAt (tiền tố - để giảm dần). Mặc định sortOrder,-createdAt'
 *         schema: { type: string, example: -price }
 *       - { in: query, name: search, description: Tìm theo tên món (có/không dấu), schema: { type: string } }
 *       - { in: query, name: categoryId, schema: { type: string } }
 *       - { in: query, name: isAvailable, description: 'true = còn món, false = hết món', schema: { type: string, enum: ['true', 'false'] } }
 *       - { in: query, name: isActive, description: 'true = đang hiện, false = đang ẩn', schema: { type: string, enum: ['true', 'false'] } }
 *       - in: query
 *         name: tags
 *         description: Món có ít nhất một trong các tag (phân tách bằng dấu phẩy)
 *         schema: { type: string, example: 'bestseller,spicy' }
 *     responses:
 *       200:
 *         description: Danh sách món
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/MenuItem' } }
 *                 meta: { $ref: '#/components/schemas/PaginationMeta' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     tags: [MenuItems]
 *     summary: Tạo món
 *     description: Bỏ trống `slug` → tự sinh từ tên. Bỏ trống `sortOrder` → xếp cuối danh mục.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/MenuItemInput' }
 *     responses:
 *       201:
 *         description: Đã tạo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/MenuItem' }
 *       400:
 *         description: Dữ liệu không hợp lệ hoặc danh mục không tồn tại (CATEGORY_NOT_FOUND)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409:
 *         description: Slug đã được sử dụng (SLUG_TAKEN)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
router.get('/', validate({ query: listMenuItemsQuerySchema }), menuController.listMenuItems);
router.post('/', validate({ body: createMenuItemSchema }), menuController.createMenuItem);

/**
 * @openapi
 * /admin/menu-items/stats:
 *   get:
 *     tags: [MenuItems]
 *     summary: Thống kê cho header màn Quản lý Thực đơn
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Số liệu
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/MenuStats' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/stats', menuController.getMenuStats);

/**
 * @openapi
 * /admin/menu-items/reorder:
 *   patch:
 *     tags: [MenuItems]
 *     summary: Sắp xếp lại món
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ReorderInput' }
 *     responses:
 *       200:
 *         description: Đã cập nhật thứ tự
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object, properties: { updated: { type: integer } } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/reorder', validate({ body: reorderSchema }), menuController.reorderMenuItems);

/**
 * @openapi
 * /admin/menu-items/{id}:
 *   parameters:
 *     - { in: path, name: id, required: true, schema: { type: string, example: 665f1c2e8b3a4d0012345678 } }
 *   get:
 *     tags: [MenuItems]
 *     summary: Chi tiết món
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Món
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/MenuItem' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [MenuItems]
 *     summary: Cập nhật món
 *     description: |
 *       Chỉ các trường gửi lên bị ghi đè; `optionGroups`, `tags` bị thay thế toàn bộ.
 *       Đổi `image` (hoặc gửi `null`) → ảnh cũ bị xoá trên Cloudinary.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/MenuItemPatch' }
 *     responses:
 *       200:
 *         description: Đã cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/MenuItem' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Slug đã được sử dụng (SLUG_TAKEN)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *   delete:
 *     tags: [MenuItems]
 *     summary: Xoá món (xoá hẳn, kèm ảnh trên Cloudinary)
 *     description: Muốn tạm ngừng bán hãy dùng `isActive=false` (ẩn) hoặc `/availability` (hết món).
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Đã xoá
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/DeletedResult' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', validate({ params: idParamsSchema }), menuController.getMenuItem);
router.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateMenuItemSchema }),
  menuController.updateMenuItem,
);
router.delete('/:id', validate({ params: idParamsSchema }), menuController.deleteMenuItem);

/**
 * @openapi
 * /admin/menu-items/{id}/availability:
 *   patch:
 *     tags: [MenuItems]
 *     summary: Đánh dấu còn món / hết món
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isAvailable]
 *             properties: { isAvailable: { type: boolean, example: false } }
 *     responses:
 *       200:
 *         description: Đã cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/MenuItem' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch(
  '/:id/availability',
  validate({ params: idParamsSchema, body: availabilitySchema }),
  menuController.setAvailability,
);

export default router;
