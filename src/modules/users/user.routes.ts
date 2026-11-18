import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import * as userController from './user.controller';
import { createUserSchema, listUsersQuerySchema, updateUserSchema } from './user.schema';

/**
 * Quản lý tài khoản nhân viên — gắn dưới /api/v1/admin/users (đã qua `authenticate`).
 * Không phân quyền: mọi tài khoản đã đăng nhập đều có toàn quyền.
 */
const router = Router();

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags: [Users]
 *     summary: Danh sách tài khoản (phân trang)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - in: query
 *         name: sort
 *         description: 'Trường sort: createdAt, updatedAt, fullName, email, lastLoginAt (tiền tố - để giảm dần)'
 *         schema: { type: string, example: -createdAt }
 *       - { in: query, name: search, description: Tìm theo họ tên hoặc email, schema: { type: string } }
 *       - { in: query, name: isActive, schema: { type: string, enum: ['true', 'false'] } }
 *     responses:
 *       200:
 *         description: Danh sách tài khoản
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/User' } }
 *                 meta: { $ref: '#/components/schemas/PaginationMeta' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     tags: [Users]
 *     summary: Tạo tài khoản nhân viên
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullName, email, password]
 *             properties:
 *               fullName: { type: string, example: Nguyễn Văn A }
 *               email: { type: string, format: email, example: nhanvien@example.com }
 *               password: { type: string, format: password, minLength: 8, maxLength: 72 }
 *     responses:
 *       201:
 *         description: Đã tạo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409:
 *         description: Email đã được sử dụng
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
router.get('/', validate({ query: listUsersQuerySchema }), userController.list);
router.post('/', validate({ body: createUserSchema }), userController.create);

/**
 * @openapi
 * /admin/users/{id}:
 *   parameters:
 *     - { in: path, name: id, required: true, schema: { type: string, example: 665f1c2e8b3a4d0012345678 } }
 *   get:
 *     tags: [Users]
 *     summary: Chi tiết tài khoản
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Thông tin tài khoản
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/User' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Users]
 *     summary: Cập nhật tài khoản (họ tên, email, trạng thái, đặt lại mật khẩu)
 *     description: |
 *       - `isActive: false` vô hiệu hoá tài khoản và thu hồi mọi phiên đăng nhập của tài khoản đó.
 *       - Không thể tự vô hiệu hoá chính mình (CANNOT_DISABLE_SELF); luôn phải còn ít nhất một tài khoản active (LAST_ACTIVE_USER).
 *       - `password` đặt lại mật khẩu và thu hồi mọi phiên đăng nhập của tài khoản đó.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               fullName: { type: string }
 *               email: { type: string, format: email }
 *               isActive: { type: boolean }
 *               password: { type: string, format: password, minLength: 8, maxLength: 72 }
 *     responses:
 *       200:
 *         description: Đã cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/User' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Email đã được sử dụng
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *   delete:
 *     tags: [Users]
 *     summary: Vô hiệu hoá tài khoản (xoá mềm, isActive = false)
 *     description: Áp dụng cùng quy tắc như PATCH isActive=false. Trả về tài khoản sau khi vô hiệu hoá.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Đã vô hiệu hoá
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/User' }
 *       400:
 *         description: Tự vô hiệu hoá chính mình hoặc là tài khoản active cuối cùng
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', validate({ params: idParamsSchema }), userController.getById);
router.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateUserSchema }),
  userController.update,
);
router.delete('/:id', validate({ params: idParamsSchema }), userController.disable);

export default router;
