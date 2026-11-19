import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import * as adminSessionController from './adminSession.controller';
import { listAdminSessionsQuerySchema, updateAdminSessionSchema } from './adminSession.schema';
import * as paymentController from './payment.controller';
import {
  cancelSessionSchema,
  listPaymentsQuerySchema,
  moveSessionSchema,
  recordPaymentSchema,
  voidPaymentSchema,
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
 * /admin/sessions:
 *   get:
 *     tags: [Sessions]
 *     summary: Danh sách phiên bàn (đang mở / lịch sử)
 *     description: |
 *       Mặc định chỉ trả phiên chưa đóng (`open`, `payment_requested`); có `closeReason` mà không có `status`
 *       → mặc định `closed`. `from`/`to` lọc theo ngày mở phiên (`openedAt`, giờ Asia/Ho_Chi_Minh, gồm cả hai đầu).
 *       `orderCount`/`subtotal` không tính đơn đã huỷ. Không bao giờ trả `sessionToken`.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - in: query
 *         name: sort
 *         description: 'openedAt, closedAt, createdAt, updatedAt (tiền tố - để giảm dần). Mặc định -openedAt.'
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         description: Một hoặc nhiều trạng thái, cách nhau bởi dấu phẩy
 *         schema: { type: string, example: 'open,payment_requested' }
 *       - { in: query, name: tableId, schema: { type: string } }
 *       - { in: query, name: areaId, schema: { type: string } }
 *       - in: query
 *         name: from
 *         description: Ngày mở phiên bắt đầu (giờ Việt Nam), gồm cả ngày này
 *         schema: { type: string, format: date, example: '2026-11-01' }
 *       - in: query
 *         name: to
 *         description: Ngày mở phiên kết thúc, gồm cả ngày này
 *         schema: { type: string, format: date, example: '2026-11-30' }
 *       - { in: query, name: closeReason, schema: { type: string, enum: [paid, cancelled] } }
 *     responses:
 *       200:
 *         description: Danh sách phiên
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/AdminSession' } }
 *                 meta: { $ref: '#/components/schemas/PaginationMeta' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
adminSessionsRouter.get(
  '/',
  validate({ query: listAdminSessionsQuerySchema }),
  adminSessionController.listSessions,
);

/**
 * @openapi
 * /admin/sessions/{id}:
 *   get:
 *     tags: [Sessions]
 *     summary: Chi tiết phiên bàn (đơn, thanh toán, hoá đơn tạm tính)
 *     description: |
 *       Như một phần tử của danh sách + `orders` (mọi đơn của phiên, kể cả đơn huỷ, cũ trước),
 *       `payment` (khi đã thu tiền) và `bill` (hoá đơn tạm tính, chỉ khi phiên chưa đóng).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Chi tiết phiên
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AdminSessionDetail' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Sessions]
 *     summary: Nhân viên sửa số khách / tên khách / ghi chú của phiên chưa đóng
 *     description: Cùng định dạng body với `PATCH /public/sessions/current`. Chuỗi rỗng → null.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateSessionBody' }
 *     responses:
 *       200:
 *         description: Phiên sau khi cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/AdminSession' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: SESSION_CLOSED — phiên đã đóng
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminSessionsRouter.get(
  '/:id',
  validate({ params: idParamsSchema }),
  adminSessionController.getSession,
);
adminSessionsRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateAdminSessionSchema }),
  adminSessionController.updateSession,
);

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
 *       - `method` chưa bật trong cài đặt (`paymentMethods`) → 422 `PAYMENT_METHOD_UNAVAILABLE`
 *         (kèm `details.paymentMethods`); phiên vẫn mở, bàn giữ nguyên trạng thái.
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
 *         description: |
 *           INSUFFICIENT_AMOUNT (tiền nhận chưa đủ), INVALID_DISCOUNT (giảm giá vượt tổng),
 *           PAYMENT_METHOD_UNAVAILABLE (phương thức chưa bật trong cài đặt; `details.paymentMethods` = các phương thức đang bật)
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
 *     summary: Danh sách thanh toán (lọc theo ngày, phương thức, bàn, trạng thái) + tổng hợp
 *     description: |
 *       Mặc định chỉ trả thanh toán còn hiệu lực (`status=completed`); `voided` = chỉ bản ghi đã huỷ,
 *       `all` = cả hai. `meta.summary` tính theo đúng bộ lọc đó (doanh thu thực = mặc định `completed`).
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
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [completed, voided, all], default: completed }
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

/**
 * @openapi
 * /admin/payments/{id}/void:
 *   post:
 *     tags: [Payments]
 *     summary: Huỷ (void) thanh toán ghi nhầm và (mặc định) mở lại phiên để thu lại
 *     description: |
 *       Dùng khi thu ngân ghi nhầm số tiền / phương thức / bàn. Bản ghi được giữ lại với `status=voided`
 *       (kèm `voidedAt`, `voidedBy`, `voidReason`) và không còn tính vào doanh thu (dashboard, `/admin/payments`).
 *
 *       `reopenSession` (mặc định `true`): phiên → `payment_requested` (mở lại, token cũ của khách dùng lại được),
 *       bàn → `needs_payment`; sau đó thu lại bằng `POST /admin/sessions/{id}/payments` (tạo bản ghi completed mới).
 *       Chỉ mở lại khi bàn KHÔNG có phiên khác đang mở — nếu có → 409 `TABLE_HAS_ACTIVE_SESSION` và thanh toán
 *       KHÔNG bị huỷ (gửi `reopenSession=false` để chỉ huỷ thanh toán). Bước sau lỗi → hoàn tác best-effort.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/VoidPaymentBody' }
 *     responses:
 *       200:
 *         description: Đã huỷ thanh toán
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/VoidPaymentResult' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: |
 *           PAYMENT_ALREADY_VOIDED (đã huỷ trước đó / bấm 2 lần), TABLE_HAS_ACTIVE_SESSION (bàn đã có phiên mới),
 *           SESSION_NOT_FOUND / SESSION_NOT_CLOSED (dữ liệu phiên không khớp)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminPaymentsRouter.post(
  '/:id/void',
  validate({ params: idParamsSchema, body: voidPaymentSchema }),
  paymentController.voidPayment,
);
