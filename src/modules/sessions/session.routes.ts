import { Router } from 'express';
import { createPublicWriteRateLimiter } from '../../middlewares/rateLimit';
import { validate } from '../../middlewares/validate';
import { listSessionOrdersQuerySchema } from '../orders/order.schema';
import * as sessionController from './session.controller';
import { requireGuestSession } from './session.middleware';
import { openSessionSchema, updateSessionSchema } from './session.schema';

/**
 * Phiên bàn của khách — gắn dưới /api/v1/public/sessions (không cần đăng nhập).
 * Tạo bằng factory để rate limiter có state riêng theo từng app instance.
 */
export function createPublicSessionRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /public/sessions:
   *   post:
   *     tags: [GuestSession]
   *     summary: Mở / tham gia phiên bàn (khách quét QR)
   *     description: |
   *       Bàn đang có phiên chưa đóng (`open`/`payment_requested`) → trả lại phiên đó (200, `isNew=false`) —
   *       nhiều khách cùng bàn dùng chung một phiên. Chưa có → mở phiên mới (201, `isNew=true`) và đánh dấu bàn `occupied`.
   *       Client lưu `sessionToken` vào localStorage và gửi ở header `X-Session-Token` cho các API khách.
   *       Khi tham gia phiên có sẵn: `guestCount` chỉ tăng (lấy giá trị lớn hơn), `customerName`/`note` chỉ điền nếu đang trống.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/OpenSessionBody' }
   *     responses:
   *       200:
   *         description: Tham gia phiên đang mở
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { $ref: '#/components/schemas/OpenSessionResult' }
   *       201:
   *         description: Đã mở phiên mới
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { $ref: '#/components/schemas/OpenSessionResult' }
   *       400: { $ref: '#/components/responses/ValidationError' }
   *       404:
   *         description: TABLE_NOT_FOUND — mã QR sai, đã bị thay hoặc bàn đã tắt
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   *       429: { $ref: '#/components/responses/TooManyRequests' }
   */
  router.post(
    '/',
    createPublicWriteRateLimiter(),
    validate({ body: openSessionSchema }),
    sessionController.openSession,
  );

  router.use('/current', requireGuestSession);

  /**
   * @openapi
   * /public/sessions/current:
   *   get:
   *     tags: [GuestSession]
   *     summary: Phiên hiện tại + bàn + tổng tạm tính cả phiên
   *     security: [{ sessionToken: [] }]
   *     responses:
   *       200:
   *         description: Thông tin phiên
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { $ref: '#/components/schemas/CurrentSession' }
   *       401: { $ref: '#/components/responses/InvalidSession' }
   *   patch:
   *     tags: [GuestSession]
   *     summary: Cập nhật số khách / tên / ghi chú của phiên
   *     security: [{ sessionToken: [] }]
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
   *                 data: { $ref: '#/components/schemas/TableSession' }
   *       400: { $ref: '#/components/responses/ValidationError' }
   *       401: { $ref: '#/components/responses/InvalidSession' }
   */
  router.get('/current', sessionController.getCurrent);
  router.patch(
    '/current',
    validate({ body: updateSessionSchema }),
    sessionController.updateCurrent,
  );

  /**
   * @openapi
   * /public/sessions/current/orders:
   *   get:
   *     tags: [GuestSession]
   *     summary: Danh sách đơn của phiên (theo dõi đơn)
   *     description: |
   *       Đơn mới nhất trước, kèm trạng thái, trạng thái từng món và timeline (`statusHistory`).
   *       Polling nhẹ: gửi `updatedSince` = `meta.serverTime` của lần gọi trước để chỉ nhận các đơn có thay đổi.
   *     security: [{ sessionToken: [] }]
   *     parameters:
   *       - in: query
   *         name: updatedSince
   *         description: ISO 8601 — chỉ trả đơn có updatedAt > updatedSince
   *         schema: { type: string, format: date-time }
   *     responses:
   *       200:
   *         description: Danh sách đơn
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { type: array, items: { $ref: '#/components/schemas/Order' } }
   *                 meta:
   *                   type: object
   *                   properties:
   *                     serverTime: { type: string, format: date-time }
   *                     count: { type: integer }
   *       400: { $ref: '#/components/responses/ValidationError' }
   *       401: { $ref: '#/components/responses/InvalidSession' }
   */
  router.get(
    '/current/orders',
    validate({ query: listSessionOrdersQuerySchema }),
    sessionController.listOrders,
  );

  return router;
}
