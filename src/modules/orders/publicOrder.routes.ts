import { Router } from 'express';
import { createPublicWriteRateLimiter } from '../../middlewares/rateLimit';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import { requireGuestSession } from '../sessions/session.middleware';
import * as orderController from './order.controller';
import { cancelOrderSchema, createOrderSchema, quoteOrderSchema } from './order.schema';

/**
 * Đặt món của khách — gắn dưới /api/v1/public/orders, xác thực bằng header X-Session-Token.
 * Giỏ hàng giữ ở client; server chỉ tính tạm (quote) và tạo đơn.
 */
export function createPublicOrderRouter(): Router {
  const router = Router();
  router.use(requireGuestSession, createPublicWriteRateLimiter());

  /**
   * @openapi
   * /public/orders/quote:
   *   post:
   *     tags: [GuestOrders]
   *     summary: Tạm tính giỏ hàng
   *     description: |
   *       Kiểm tra giỏ hàng và tính subtotal, phí phục vụ, VAT, tổng theo cài đặt nhà hàng (giá lấy từ DB).
   *       Không lưu gì. `canOrderNow` cho biết hiện có đặt được không.
   *       Phí phục vụ = subtotal × %; VAT = (subtotal + phí phục vụ) × %; làm tròn từng khoản.
   *     security: [{ sessionToken: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/QuoteOrderBody' }
   *     responses:
   *       200:
   *         description: Tạm tính
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { $ref: '#/components/schemas/OrderQuote' }
   *       400: { $ref: '#/components/responses/ValidationError' }
   *       401: { $ref: '#/components/responses/InvalidSession' }
   *       422: { $ref: '#/components/responses/OrderItemsInvalid' }
   *       429: { $ref: '#/components/responses/TooManyRequests' }
   */
  router.post('/quote', validate({ body: quoteOrderSchema }), orderController.quote);

  /**
   * @openapi
   * /public/orders:
   *   post:
   *     tags: [GuestOrders]
   *     summary: Đặt món (có thể đặt nhiều đơn trong một phiên)
   *     description: |
   *       Validate món tồn tại, đang hiện, còn món, lựa chọn hợp lệ, số lượng ≤ `ordering.maxItemQuantityPerOrder`
   *       (tính tổng theo món), nhà hàng đang nhận đơn. Giá luôn lấy từ DB.
   *       Đơn tạo ra ở `pending`, hoặc `confirmed` nếu `ordering.requireStaffConfirm=false`.
   *       Mã đơn `orderNumber` dạng `ORD-0001`, đánh số lại mỗi ngày (giờ Việt Nam).
   *     security: [{ sessionToken: [] }]
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
   *                 data: { $ref: '#/components/schemas/Order' }
   *       400: { $ref: '#/components/responses/ValidationError' }
   *       401: { $ref: '#/components/responses/InvalidSession' }
   *       409:
   *         description: |
   *           SESSION_NOT_OPEN (bàn đã yêu cầu thanh toán), ORDERING_DISABLED (tắt đặt món qua QR),
   *           RESTAURANT_CLOSED (ngoài giờ nhận đơn)
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   *       422: { $ref: '#/components/responses/OrderItemsInvalid' }
   *       429: { $ref: '#/components/responses/TooManyRequests' }
   */
  router.post('/', validate({ body: createOrderSchema }), orderController.create);

  /**
   * @openapi
   * /public/orders/{id}/cancel:
   *   post:
   *     tags: [GuestOrders]
   *     summary: Khách huỷ đơn (chỉ khi còn pending)
   *     security: [{ sessionToken: [] }]
   *     parameters:
   *       - { in: path, name: id, required: true, schema: { type: string } }
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               reason: { type: string, maxLength: 300, nullable: true }
   *     responses:
   *       200:
   *         description: Đơn đã huỷ
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { $ref: '#/components/schemas/Order' }
   *       401: { $ref: '#/components/responses/InvalidSession' }
   *       404: { $ref: '#/components/responses/NotFound' }
   *       409:
   *         description: ORDER_NOT_CANCELLABLE — đơn không còn pending
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   */
  router.post(
    '/:id/cancel',
    validate({ params: idParamsSchema, body: cancelOrderSchema }),
    orderController.cancel,
  );

  return router;
}
