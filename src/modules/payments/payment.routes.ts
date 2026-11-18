import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import * as paymentController from './payment.controller';
import {
  cancelSessionSchema,
  listPaymentsQuerySchema,
  moveSessionSchema,
  recordPaymentSchema,
} from './payment.schema';

/**
 * Hoá đơn của bàn — gắn thêm dưới /api/v1/admin/tables (cùng path với adminTablesRouter).
 */
export const adminTableBillRouter = Router();

/**
 * @openapi
 * /admin/tables/{id}/bill:
 *   get:
 *     tags: [Payments]
 *     summary: Hoá đơn tạm tính của phiên đang mở trên bàn
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Hoá đơn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Bill' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404:
 *         description: NOT_FOUND (không có bàn) / NO_ACTIVE_SESSION (bàn đang trống)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminTableBillRouter.get(
  '/:id/bill',
  validate({ params: idParamsSchema }),
  paymentController.getTableBill,
);

/**
 * Thao tác của nhân viên trên phiên bàn — gắn dưới /api/v1/admin/sessions.
 */
export const adminSessionsRouter = Router();

/**
 * @openapi
 * /admin/sessions/{id}/bill:
 *   get:
 *     tags: [Payments]
 *     summary: Hoá đơn tạm tính của phiên
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Hoá đơn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Bill' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: SESSION_CLOSED — phiên đã đóng
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminSessionsRouter.get(
  '/:id/bill',
  validate({ params: idParamsSchema }),
  paymentController.getSessionBill,
);

/**
 * @openapi
 * /admin/sessions/{id}/payments:
 *   post:
 *     tags: [Payments]
 *     summary: Ghi nhận thanh toán (thủ công) và đóng phiên
 *     description: |
 *       Tính tiền từ mọi đơn không bị huỷ của phiên (bỏ món đã huỷ): phí phục vụ = subtotal × %,
 *       VAT = (subtotal + phí) × %, làm tròn từng khoản theo tiền tệ (VND: tới 1 đồng);
 *       giảm giá (`discountAmount`, số tiền) trừ vào tổng sau VAT/phí.
 *
 *       - Còn đơn `pending`/`confirmed`/`preparing` → 409 `UNFINISHED_ORDERS` (kèm `details.unfinishedOrders`);
 *         gửi `force=true` để vẫn thu, bản ghi lưu `forced=true` và `warnings`.
 *       - `amountReceived` < tổng → 422 `INSUFFICIENT_AMOUNT`; tiền thối `change = amountReceived − total`.
 *         Chuyển khoản/thẻ có thể bỏ trống `amountReceived` (= tổng).
 *
 *       Thành công: tạo Payment, phiên → `closed` (token cũ của khách bị từ chối, quét QR lại sẽ mở phiên mới),
 *       bàn → `available`, các yêu cầu phục vụ còn mở của phiên → `done`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RecordPaymentBody' }
 *     responses:
 *       201:
 *         description: Đã ghi nhận thanh toán, phiên đã đóng
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/RecordPaymentResult' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: |
 *           SESSION_CLOSED / SESSION_ALREADY_PAID, UNFINISHED_ORDERS (còn đơn chưa xử lý, chưa force),
 *           NOTHING_TO_PAY (phiên chưa có món — dùng huỷ phiên), BILL_CHANGED (khách vừa đặt/huỷ đơn, tải lại hoá đơn)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: INSUFFICIENT_AMOUNT (tiền nhận chưa đủ), INVALID_DISCOUNT (giảm giá vượt tổng)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminSessionsRouter.post(
  '/:id/payments',
  validate({ params: idParamsSchema, body: recordPaymentSchema }),
  paymentController.recordPayment,
);

/**
 * @openapi
 * /admin/sessions/{id}/move:
 *   post:
 *     tags: [Payments]
 *     summary: Chuyển phiên sang bàn khác
 *     description: |
 *       Bàn đích phải đang hoạt động và `available`. Đơn và yêu cầu phục vụ đi theo phiên,
 *       token của khách vẫn dùng được. Bàn cũ → `available`; bàn mới → `occupied`
 *       (hoặc `needs_payment` nếu phiên đã yêu cầu thanh toán).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [toTableId]
 *             properties:
 *               toTableId: { type: string, example: '665f1c2e8b3a4d0012345678' }
 *     responses:
 *       200:
 *         description: Đã chuyển bàn
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/MoveSessionResult' }
 *       400:
 *         description: VALIDATION_ERROR / SAME_TABLE
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: TABLE_NOT_AVAILABLE (bàn đích không trống), TABLE_INACTIVE, SESSION_CLOSED
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminSessionsRouter.post(
  '/:id/move',
  validate({ params: idParamsSchema, body: moveSessionSchema }),
  paymentController.moveSession,
);

/**
 * @openapi
 * /admin/sessions/{id}/cancel:
 *   post:
 *     tags: [Payments]
 *     summary: Huỷ phiên trống (không có món nào được tính tiền)
 *     description: Đóng phiên (closeReason=cancelled), bàn → available, yêu cầu phục vụ còn mở → done.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, maxLength: 300, nullable: true, example: 'Khách quét nhầm bàn' }
 *     responses:
 *       200:
 *         description: Đã huỷ phiên
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     session: { $ref: '#/components/schemas/ClosedSessionInfo' }
 *                     table: { $ref: '#/components/schemas/PaymentTableRef' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: SESSION_NOT_EMPTY (phiên đã có món), SESSION_CLOSED
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminSessionsRouter.post(
  '/:id/cancel',
  validate({ params: idParamsSchema, body: cancelSessionSchema }),
  paymentController.cancelSession,
);

/**
 * Lịch sử thanh toán — gắn dưới /api/v1/admin/payments.
 */
export const adminPaymentsRouter = Router();

/**
 * @openapi
 * /admin/payments:
 *   get:
 *     tags: [Payments]
 *     summary: Danh sách thanh toán (lọc theo ngày, phương thức, bàn) + tổng hợp
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - in: query
 *         name: sort
 *         description: 'paidAt, total, createdAt (tiền tố - để giảm dần). Mặc định -paidAt.'
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         description: Ngày kinh doanh bắt đầu (giờ Việt Nam), gồm cả ngày này
 *         schema: { type: string, format: date, example: '2026-11-01' }
 *       - in: query
 *         name: to
 *         description: Ngày kinh doanh kết thúc, gồm cả ngày này
 *         schema: { type: string, format: date, example: '2026-11-30' }
 *       - { in: query, name: method, schema: { type: string, enum: [cash, bank_transfer, card] } }
 *       - { in: query, name: tableId, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Danh sách thanh toán; `meta.summary` tổng hợp theo toàn bộ bộ lọc (không chỉ trang hiện tại)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/Payment' } }
 *                 meta:
 *                   allOf:
 *                     - { $ref: '#/components/schemas/PaginationMeta' }
 *                     - type: object
 *                       properties:
 *                         summary: { $ref: '#/components/schemas/PaymentSummary' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
adminPaymentsRouter.get(
  '/',
  validate({ query: listPaymentsQuerySchema }),
  paymentController.listPayments,
);

/**
 * @openapi
 * /admin/payments/{id}:
 *   get:
 *     tags: [Payments]
 *     summary: Chi tiết một thanh toán
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Thanh toán
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/Payment' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
adminPaymentsRouter.get('/:id', validate({ params: idParamsSchema }), paymentController.getPayment);
