import { Router } from 'express';
import { createPublicWriteRateLimiter } from '../../middlewares/rateLimit';
import { validate } from '../../middlewares/validate';
import { idParamsSchema } from '../../utils/objectId';
import { requireGuestSession } from '../sessions/session.middleware';
import * as serviceRequestController from './serviceRequest.controller';
import {
  createServiceRequestSchema,
  listAdminServiceRequestsQuerySchema,
  listGuestServiceRequestsQuerySchema,
  updateServiceRequestSchema,
} from './serviceRequest.schema';

/**
 * Yêu cầu nhanh tại bàn của khách — gắn dưới /api/v1/public/service-requests (header X-Session-Token).
 * Tạo bằng factory để rate limiter có state riêng theo từng app instance.
 */
export function createPublicServiceRequestRouter(): Router {
  const router = Router();
  router.use(requireGuestSession);

  /**
   * @openapi
   * /public/service-requests:
   *   post:
   *     tags: [GuestServiceRequests]
   *     summary: Gửi yêu cầu nhanh (gọi nhân viên, xin nước, dụng cụ, thanh toán, khác)
   *     description: |
   *       Chống spam: nếu phiên đã có yêu cầu CÙNG LOẠI đang `pending` → 409 `SERVICE_REQUEST_DUPLICATE`
   *       (`details` = yêu cầu đang chờ). Khi nhân viên đã tiếp nhận/hoàn tất, khách gửi lại được.
   *       `request_bill` chỉ báo cho nhân viên, không đổi trạng thái phiên.
   *     security: [{ sessionToken: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/CreateServiceRequestBody' }
   *     responses:
   *       201:
   *         description: Đã gửi yêu cầu
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { $ref: '#/components/schemas/GuestServiceRequest' }
   *       400: { $ref: '#/components/responses/ValidationError' }
   *       401: { $ref: '#/components/responses/InvalidSession' }
   *       409:
   *         description: SERVICE_REQUEST_DUPLICATE — đã có yêu cầu cùng loại đang chờ
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/ErrorResponse' }
   *       429: { $ref: '#/components/responses/TooManyRequests' }
   */
  router.post(
    '/',
    createPublicWriteRateLimiter(),
    validate({ body: createServiceRequestSchema }),
    serviceRequestController.createByGuest,
  );

  /**
   * @openapi
   * /public/service-requests:
   *   get:
   *     tags: [GuestServiceRequests]
   *     summary: Yêu cầu của phiên hiện tại (mới nhất trước, tối đa 100)
   *     security: [{ sessionToken: [] }]
   *     parameters:
   *       - in: query
   *         name: updatedSince
   *         description: Chỉ trả yêu cầu có thay đổi sau thời điểm này (dùng `meta.serverTime` lần trước)
   *         schema: { type: string, format: date-time }
   *     responses:
   *       200:
   *         description: Danh sách yêu cầu
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { type: array, items: { $ref: '#/components/schemas/GuestServiceRequest' } }
   *                 meta:
   *                   type: object
   *                   properties:
   *                     serverTime: { type: string, format: date-time }
   *       401: { $ref: '#/components/responses/InvalidSession' }
   */
  router.get(
    '/',
    validate({ query: listGuestServiceRequestsQuerySchema }),
    serviceRequestController.listByGuest,
  );

  return router;
}

/** Nhân viên xử lý yêu cầu nhanh — gắn dưới /api/v1/admin/service-requests. */
export const adminServiceRequestsRouter = Router();

/**
 * @openapi
 * /admin/service-requests:
 *   get:
 *     tags: [ServiceRequests]
 *     summary: Danh sách yêu cầu nhanh tại bàn
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         description: pending | acknowledged | done, nhiều giá trị cách nhau bởi dấu phẩy
 *         schema: { type: string, example: 'pending,acknowledged' }
 *       - in: query
 *         name: type
 *         description: Một hoặc nhiều loại, cách nhau bởi dấu phẩy
 *         schema: { type: string }
 *       - { in: query, name: tableId, schema: { type: string } }
 *       - { in: query, name: areaId, schema: { type: string } }
 *       - in: query
 *         name: updatedSince
 *         description: Chỉ trả yêu cầu có updatedAt > thời điểm này (polling, dùng `meta.serverTime`)
 *         schema: { type: string, format: date-time }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 20, maximum: 100 } }
 *       - in: query
 *         name: sort
 *         description: createdAt | updatedAt | status | type (mặc định -createdAt)
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Danh sách yêu cầu
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/ServiceRequest' } }
 *                 meta: { $ref: '#/components/schemas/PollingPaginationMeta' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
adminServiceRequestsRouter.get(
  '/',
  validate({ query: listAdminServiceRequestsQuerySchema }),
  serviceRequestController.listByStaff,
);

/**
 * @openapi
 * /admin/service-requests/{id}:
 *   patch:
 *     tags: [ServiceRequests]
 *     summary: Tiếp nhận / hoàn tất yêu cầu
 *     description: pending → acknowledged | done; acknowledged → done. Ghi `handledBy` = nhân viên thao tác.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [acknowledged, done] }
 *     responses:
 *       200:
 *         description: Yêu cầu sau khi cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/ServiceRequest' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: INVALID_STATUS_TRANSITION — `details` = `{ from, to }`
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
adminServiceRequestsRouter.patch(
  '/:id',
  validate({ params: idParamsSchema, body: updateServiceRequestSchema }),
  serviceRequestController.updateByStaff,
);
