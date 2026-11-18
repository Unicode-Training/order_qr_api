import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import * as adminOrderController from './adminOrder.controller';
import {
  listAdminOrdersQuerySchema,
  orderBoardQuerySchema,
  orderItemParamsSchema,
  staffCreateOrderSchema,
  updateOrderItemSchema,
  updateOrderStatusSchema,
} from './adminOrder.schema';

/** Điều phối đơn cho nhân viên/bếp — gắn dưới /api/v1/admin/orders (cần đăng nhập). */
export const adminOrdersRouter = Router();

/**
 * @openapi
 * /admin/orders:
 *   get:
 *     tags: [AdminOrders]
 *     summary: Danh sách đơn (lọc, phân trang, polling)
 *     description: |
 *       Dùng `updatedSince` = `meta.serverTime` của lần gọi trước để chỉ lấy các đơn mới/có thay đổi (dashboard polling).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         description: Một hoặc nhiều trạng thái, cách nhau bởi dấu phẩy
 *         schema: { type: string, example: 'pending,confirmed' }
 *       - { in: query, name: tableId, schema: { type: string } }
 *       - { in: query, name: areaId, schema: { type: string } }
 *       - in: query
 *         name: dateFrom
 *         description: Ngày kinh doanh (giờ nhà hàng) từ, YYYY-MM-DD
 *         schema: { type: string, example: '2026-11-01' }
 *       - in: query
 *         name: dateTo
 *         description: Ngày kinh doanh đến (tính cả ngày này), YYYY-MM-DD
 *         schema: { type: string, example: '2026-11-18' }
 *       - in: query
 *         name: search
 *         description: Tìm theo mã đơn (một phần), vd. 0802
 *         schema: { type: string }
 *       - in: query
 *         name: updatedSince
 *         description: Chỉ trả đơn có updatedAt > thời điểm này (ISO 8601)
 *         schema: { type: string, format: date-time }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - in: query
 *         name: sort
 *         description: createdAt | updatedAt | orderNumber | subtotal, thêm "-" để giảm dần (mặc định -createdAt)
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách đơn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/AdminOrder' } }
 *                 meta: { $ref: '#/components/schemas/PollingPaginationMeta' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
adminOrdersRouter.get(
  '/',
  validate({ query: listAdminOrdersQuerySchema }),
  adminOrderController.list,
);

/**
 * @openapi
 * /admin/orders/board:
 *   get:
 *     tags: [AdminOrders]
 *     summary: Bảng điều phối Live Orders (gom theo cột trạng thái trong ngày)
 *     description: |
 *       Đơn của một ngày kinh doanh, gom theo cột pending/confirmed/preparing/ready/served kèm số đếm.
 *       Cột đang xử lý: đơn cũ nhất lên đầu; cột served: đơn vừa phục vụ lên đầu. Đơn huỷ chỉ có số đếm (`counts.cancelled`).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: date
 *         description: YYYY-MM-DD, mặc định hôm nay (giờ nhà hàng)
 *         schema: { type: string }
 *       - { in: query, name: areaId, schema: { type: string } }
 *       - { in: query, name: tableId, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Board
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/OrderBoard' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
adminOrdersRouter.get(
  '/board',
  validate({ query: orderBoardQuerySchema }),
  adminOrderController.board,
);

/**
 * @openapi
 * /admin/orders/{id}:
 *   get:
 *     tags: [AdminOrders]
 *     summary: Chi tiết đơn
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Đơn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AdminOrder' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
adminOrdersRouter.get('/:id', validate({ params: idParamsSchema }), adminOrderController.getById);

/**
 * @openapi
 * /admin/orders/{id}/status:
 *   patch:
 *     tags: [AdminOrders]
 *     summary: Chuyển trạng thái đơn
 *     description: |
 *       State machine: pending → confirmed | cancelled; confirmed → preparing | cancelled; preparing → ready; ready → served.
 *       Ghi `statusHistory` kèm nhân viên thao tác. Huỷ đơn bắt buộc `reason`.
 *       Các món chưa huỷ được chuyển theo trạng thái đơn (không lùi món đã đi trước); huỷ đơn → huỷ mọi món.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateOrderStatusBody' }
 *     responses:
 *       200:
 *         description: Đơn sau khi cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AdminOrder' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: INVALID_STATUS_TRANSITION — `details` = `{ from, to, allowed }`
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminOrdersRouter.patch(
  '/:id/status',
  validate({ params: idParamsSchema, body: updateOrderStatusSchema }),
  adminOrderController.updateStatus,
);

/**
 * @openapi
 * /admin/orders/{id}/items/{itemId}:
 *   patch:
 *     tags: [AdminOrders]
 *     summary: Cập nhật một món trong đơn (trạng thái / huỷ món / hết món)
 *     description: |
 *       - `itemStatus`: preparing | ready | served (chỉ tiến lên) hoặc cancelled (kèm `reason`).
 *       - `markSoldOut: true`: huỷ món với lý do mặc định "Hết món" và đặt món trong thực đơn thành hết (`isAvailable=false`).
 *       Huỷ món → tính lại `subtotal` (không tính món đã huỷ). Huỷ hết mọi món → đơn tự chuyển `cancelled`.
 *       Đơn pending chỉ được huỷ món; đơn served/cancelled không sửa được.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: itemId, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateOrderItemBody' }
 *     responses:
 *       200:
 *         description: Đơn sau khi cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AdminOrder' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: |
 *           ORDER_CLOSED (đơn đã served/cancelled), ORDER_NOT_CONFIRMED (đơn còn pending),
 *           INVALID_ITEM_STATUS_TRANSITION, CONCURRENT_UPDATE (bị ghi chồng, thử lại)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminOrdersRouter.patch(
  '/:id/items/:itemId',
  validate({ params: orderItemParamsSchema, body: updateOrderItemSchema }),
  adminOrderController.updateItem,
);

/** Nhân viên tạo đơn thay khách — gắn dưới /api/v1/admin/tables (cạnh router quản lý bàn). */
export const adminTableOrdersRouter = Router();

/**
 * @openapi
 * /admin/tables/{id}/orders:
 *   post:
 *     tags: [AdminOrders]
 *     summary: Nhân viên tạo đơn thay khách cho một bàn
 *     description: |
 *       Bàn chưa có phiên → tự mở phiên mới (bàn chuyển `occupied`, `meta.sessionCreated=true`).
 *       Không bị chặn bởi giờ mở cửa hay `ordering.enabled` (dành cho khách), nhưng vẫn kiểm tra món còn bán,
 *       lựa chọn hợp lệ và giới hạn số lượng. Đơn tạo ra ở trạng thái `confirmed`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateOrderBody' }
 *     responses:
 *       201:
 *         description: Đơn đã tạo
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AdminOrder' }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     sessionCreated: { type: boolean }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: TABLE_INACTIVE (bàn đã tắt), SESSION_NOT_OPEN (bàn đã yêu cầu thanh toán)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422: { $ref: '#/components/responses/OrderItemsInvalid' }
 */
adminTableOrdersRouter.post(
  '/:id/orders',
  validate({ params: idParamsSchema, body: staffCreateOrderSchema }),
  adminOrderController.createForTable,
);
