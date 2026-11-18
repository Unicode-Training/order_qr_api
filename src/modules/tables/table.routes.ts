import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middlewares/validate';
import { idParamsSchema, objectIdSchema } from '../../utils/objectId';
import * as tableController from './table.controller';
import {
  createTableSchema,
  listTablesQuerySchema,
  qrExportQuerySchema,
  qrImageQuerySchema,
  qrTokenParamsSchema,
  updateTableSchema,
} from './table.schema';

/**
 * Quản lý bàn & mã QR — gắn dưới /api/v1/admin/tables (đã qua `authenticate`).
 * Lưu ý: route tĩnh (/stats, /qr/export) phải khai báo TRƯỚC /:id.
 */
export const adminTablesRouter = Router();

/**
 * @openapi
 * /admin/tables:
 *   get:
 *     tags: [Tables]
 *     summary: Danh sách bàn (lọc theo khu vực, trạng thái; phân trang)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - in: query
 *         name: sort
 *         description: 'Trường sort: code, name, capacity, status, createdAt, updatedAt (tiền tố - để giảm dần). Mặc định code tăng dần.'
 *         schema: { type: string, example: code }
 *       - in: query
 *         name: areaId
 *         description: ID khu vực, hoặc `none` để lấy bàn chưa gán khu vực
 *         schema: { type: string }
 *       - { in: query, name: status, schema: { $ref: '#/components/schemas/TableStatus' } }
 *       - { in: query, name: isActive, schema: { type: string, enum: ['true', 'false'] } }
 *       - { in: query, name: search, description: Tìm theo mã hoặc tên bàn, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Danh sách bàn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Table' } }
 *                 meta: { $ref: '#/components/schemas/PaginationMeta' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     tags: [Tables]
 *     summary: Tạo bàn (tự sinh qrToken)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string, example: B08, description: 'Tự viết hoa; chữ, số, - và _; unique' }
 *               name: { type: string, example: Bàn 08, description: 'Mặc định "Bàn <code>"' }
 *               areaId: { type: string, nullable: true }
 *               capacity: { type: integer, minimum: 1, maximum: 100, default: 4 }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201:
 *         description: Đã tạo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Table' }
 *       400:
 *         description: Dữ liệu không hợp lệ hoặc khu vực không tồn tại (AREA_NOT_FOUND)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409:
 *         description: Mã bàn đã tồn tại (TABLE_CODE_EXISTS)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
adminTablesRouter.get('/', validate({ query: listTablesQuerySchema }), tableController.list);
adminTablesRouter.post('/', validate({ body: createTableSchema }), tableController.create);

/**
 * @openapi
 * /admin/tables/stats:
 *   get:
 *     tags: [Tables]
 *     summary: Thống kê đầu màn hình (tổng bàn, đang phục vụ, trống, chờ thanh toán)
 *     description: Các số đếm chỉ tính bàn đang hoạt động; `inactive` là số bàn đã tắt.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: areaId, description: Chỉ thống kê trong khu vực, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Thống kê
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/TableStats' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
adminTablesRouter.get(
  '/stats',
  validate({ query: z.object({ areaId: objectIdSchema.optional() }) }),
  tableController.stats,
);

/**
 * @openapi
 * /admin/tables/qr/export:
 *   get:
 *     tags: [Tables]
 *     summary: Xuất mã QR nhiều bàn (file ZIP chứa các ảnh PNG `<code>.png`)
 *     description: |
 *       Mặc định xuất mọi bàn đang hoạt động. Lọc bằng `areaId` hoặc `ids` (danh sách id, phân tách bằng dấu phẩy).
 *       Tối đa 500 bàn mỗi lần.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: areaId, schema: { type: string } }
 *       - { in: query, name: ids, description: 'id1,id2,...', schema: { type: string } }
 *       - { in: query, name: includeInactive, schema: { type: string, enum: ['true', 'false'], default: 'false' } }
 *       - { in: query, name: size, description: Cạnh ảnh (px), schema: { type: integer, minimum: 64, maximum: 2048, default: 512 } }
 *     responses:
 *       200:
 *         description: File ZIP
 *         content:
 *           application/zip:
 *             schema: { type: string, format: binary }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404:
 *         description: Không có bàn nào phù hợp
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
adminTablesRouter.get(
  '/qr/export',
  validate({ query: qrExportQuerySchema }),
  tableController.exportQr,
);

/**
 * @openapi
 * /admin/tables/{id}:
 *   parameters:
 *     - { in: path, name: id, required: true, schema: { type: string, example: 665f1c2e8b3a4d0012345678 } }
 *   get:
 *     tags: [Tables]
 *     summary: Chi tiết bàn
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Bàn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Table' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Tables]
 *     summary: Cập nhật bàn
 *     description: Trạng thái (`status`) không sửa ở đây — do module phiên bàn cập nhật.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               code: { type: string }
 *               name: { type: string }
 *               areaId: { type: string, nullable: true }
 *               capacity: { type: integer, minimum: 1, maximum: 100 }
 *               isActive: { type: boolean, description: 'false → QR của bàn không còn dùng được' }
 *     responses:
 *       200:
 *         description: Đã cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Table' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Mã bàn đã tồn tại (TABLE_CODE_EXISTS)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *   delete:
 *     tags: [Tables]
 *     summary: Xoá bàn
 *     description: Không cho xoá bàn đang phục vụ / chờ thanh toán. Muốn ngừng dùng tạm thời, đặt `isActive=false`.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Đã xoá, trả về bàn vừa xoá
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Table' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Bàn đang được phục vụ (TABLE_IN_USE)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
adminTablesRouter.get('/:id', validate({ params: idParamsSchema }), tableController.getById);
adminTablesRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateTableSchema }),
  tableController.update,
);
adminTablesRouter.delete('/:id', validate({ params: idParamsSchema }), tableController.remove);

/**
 * @openapi
 * /admin/tables/{id}/qr:
 *   get:
 *     tags: [Tables]
 *     summary: Ảnh mã QR của bàn (PNG hoặc SVG)
 *     description: 'Nội dung QR: `${CLIENT_URL}/t/${qrToken}`.'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: format, schema: { type: string, enum: [png, svg], default: png } }
 *       - { in: query, name: size, description: Cạnh ảnh (px), schema: { type: integer, minimum: 64, maximum: 2048, default: 512 } }
 *       - { in: query, name: download, description: 'true → tải file (Content-Disposition: attachment)', schema: { type: string, enum: ['true', 'false'] } }
 *     responses:
 *       200:
 *         description: Ảnh QR
 *         content:
 *           image/png: { schema: { type: string, format: binary } }
 *           image/svg+xml: { schema: { type: string } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
adminTablesRouter.get(
  '/:id/qr',
  validate({ params: idParamsSchema, query: qrImageQuerySchema }),
  tableController.qrImage,
);

/**
 * @openapi
 * /admin/tables/{id}/qr/regenerate:
 *   post:
 *     tags: [Tables]
 *     summary: Sinh mã QR mới (vô hiệu hoá mã QR cũ đã in)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Bàn với qrToken mới
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Table' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
adminTablesRouter.post(
  '/:id/qr/regenerate',
  validate({ params: idParamsSchema }),
  tableController.regenerateQr,
);

/**
 * Khách quét QR — gắn dưới /api/v1/public/tables (không cần đăng nhập).
 */
export const publicTablesRouter = Router();

/**
 * @openapi
 * /public/tables/resolve/{qrToken}:
 *   get:
 *     tags: [Public Tables]
 *     summary: Xác định bàn từ mã QR khách vừa quét
 *     description: 404 (TABLE_NOT_FOUND) nếu token sai, đã bị thay bằng regenerate, hoặc bàn đã tắt.
 *     parameters:
 *       - { in: path, name: qrToken, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Bàn và thông tin nhà hàng công khai
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     table:
 *                       type: object
 *                       properties:
 *                         id: { type: string }
 *                         code: { type: string, example: B08 }
 *                         name: { type: string, example: Bàn 08 }
 *                         area: { $ref: '#/components/schemas/TableAreaRef' }
 *                     restaurant: { $ref: '#/components/schemas/PublicRestaurant' }
 *       404:
 *         description: Mã QR không hợp lệ
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
publicTablesRouter.get(
  '/resolve/:qrToken',
  validate({ params: qrTokenParamsSchema }),
  tableController.resolvePublic,
);
