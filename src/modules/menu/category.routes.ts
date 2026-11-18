import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import * as menuController from './menu.controller';
import {
  createCategorySchema,
  listCategoriesQuerySchema,
  reorderSchema,
  updateCategorySchema,
} from './menu.schema';

/** Danh mục món — gắn dưới /api/v1/admin/categories (đã qua `authenticate`). */
const router = Router();

/**
 * @openapi
 * /admin/categories:
 *   get:
 *     tags: [Categories]
 *     summary: Danh sách danh mục (theo sortOrder, kèm số món)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: search, description: Tìm theo tên (có/không dấu), schema: { type: string } }
 *       - { in: query, name: isActive, schema: { type: string, enum: ['true', 'false'] } }
 *     responses:
 *       200:
 *         description: Danh sách danh mục
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Category' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     tags: [Categories]
 *     summary: Tạo danh mục
 *     description: Bỏ trống `slug` → tự sinh từ tên (không dấu, tự thêm -2, -3 nếu trùng). Bỏ trống `sortOrder` → xếp cuối.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CategoryInput' }
 *     responses:
 *       201:
 *         description: Đã tạo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Category' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409:
 *         description: Slug đã được sử dụng (SLUG_TAKEN)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
router.get('/', validate({ query: listCategoriesQuerySchema }), menuController.listCategories);
router.post('/', validate({ body: createCategorySchema }), menuController.createCategory);

/**
 * @openapi
 * /admin/categories/reorder:
 *   patch:
 *     tags: [Categories]
 *     summary: Sắp xếp lại danh mục
 *     description: Gửi `sortOrder` mới cho các danh mục cần đổi thứ tự (vd. sau khi kéo thả). Trả về danh sách sau khi sắp xếp.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ReorderInput' }
 *     responses:
 *       200:
 *         description: Danh sách danh mục sau khi sắp xếp
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Category' } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/reorder', validate({ body: reorderSchema }), menuController.reorderCategories);

/**
 * @openapi
 * /admin/categories/{id}:
 *   parameters:
 *     - { in: path, name: id, required: true, schema: { type: string, example: 665f1c2e8b3a4d0012345678 } }
 *   get:
 *     tags: [Categories]
 *     summary: Chi tiết danh mục
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh mục
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Category' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Categories]
 *     summary: Cập nhật danh mục
 *     description: Đổi `image` (hoặc gửi `null`) → ảnh cũ bị xoá trên Cloudinary.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CategoryPatch' }
 *     responses:
 *       200:
 *         description: Đã cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Category' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Slug đã được sử dụng (SLUG_TAKEN)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *   delete:
 *     tags: [Categories]
 *     summary: Xoá danh mục (chỉ khi không còn món)
 *     description: Danh mục còn món → 409 CATEGORY_NOT_EMPTY (chuyển/xoá món trước, hoặc ẩn danh mục bằng `isActive=false`). Ảnh của danh mục bị xoá trên Cloudinary.
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
 *       409:
 *         description: Danh mục còn món (CATEGORY_NOT_EMPTY)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
router.get('/:id', validate({ params: idParamsSchema }), menuController.getCategory);
router.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateCategorySchema }),
  menuController.updateCategory,
);
router.delete('/:id', validate({ params: idParamsSchema }), menuController.deleteCategory);

export default router;
