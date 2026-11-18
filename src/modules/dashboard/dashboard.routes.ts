import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import * as dashboardController from './dashboard.controller';
import {
  paymentMethodsQuerySchema,
  recentOrdersQuerySchema,
  revenueQuerySchema,
  summaryQuerySchema,
  topItemsQuerySchema,
} from './dashboard.schema';

/**
 * Tổng quan quản trị & vận hành — gắn dưới /api/v1/admin/dashboard (đã qua `authenticate`).
 * Mọi ngày đều là ngày lịch theo giờ nhà hàng (Asia/Ho_Chi_Minh).
 */
const router = Router();

/**
 * @openapi
 * /admin/dashboard/summary:
 *   get:
 *     tags: [Dashboard]
 *     summary: Chỉ số tổng quan của một ngày
 *     description: |
 *       - Doanh thu = tổng `total` của các thanh toán có ngày kinh doanh = `date`, so với ngày hôm trước
 *         (cả ngày). `changePercent` = null khi hôm qua = 0 mà hôm nay > 0.
 *       - Số đơn = đơn tạo trong ngày, không tính đơn huỷ.
 *       - Giá trị trung bình / hoá đơn = doanh thu / số thanh toán.
 *       - Thời gian phục vụ trung bình: từ lần `confirmed` đầu tiên tới lần `served` cuối cùng trong
 *         `statusHistory`, các đơn `served` của ngày.
 *       - `tables` và `pending` luôn là trạng thái **hiện tại** (không phụ thuộc `date`).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: date, schema: { type: string, format: date, example: '2026-11-18' }, description: 'Mặc định hôm nay' }
 *     responses:
 *       200:
 *         description: Tổng quan
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/DashboardSummary' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/summary', validate({ query: summaryQuerySchema }), dashboardController.summary);

/**
 * @openapi
 * /admin/dashboard/revenue:
 *   get:
 *     tags: [Dashboard]
 *     summary: Chuỗi doanh thu & số khách cho biểu đồ
 *     description: |
 *       Nhóm thanh toán theo `paidAt` (giờ Asia/Ho_Chi_Minh) theo giờ / ngày / tháng; mốc không có
 *       dữ liệu được điền 0. Số khách = tổng `guestCount` của phiên đã thanh toán (phiên không khai
 *       báo số khách tính là 1).
 *       Mặc định `from` = `to` = hôm nay; `groupBy` mặc định `hour` nếu một ngày, ngược lại `day`.
 *       Giới hạn khoảng: hour ≤ 31 ngày, day ≤ 366 ngày, month ≤ 5 năm.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date, example: '2026-11-01' } }
 *       - { in: query, name: to, schema: { type: string, format: date, example: '2026-11-18' } }
 *       - { in: query, name: groupBy, schema: { type: string, enum: [hour, day, month] } }
 *     responses:
 *       200:
 *         description: Chuỗi dữ liệu
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/DashboardRevenueSeries' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/revenue', validate({ query: revenueQuerySchema }), dashboardController.revenue);

/**
 * @openapi
 * /admin/dashboard/top-items:
 *   get:
 *     tags: [Dashboard]
 *     summary: Món bán chạy
 *     description: |
 *       Tính trên các đơn tạo trong khoảng ngày (không tính đơn huỷ và món bị huỷ), sắp theo số lượng
 *       giảm dần rồi doanh thu. Doanh thu = tổng `lineTotal` (giá món, chưa gồm VAT/phí/giảm giá).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date }, description: 'Mặc định hôm nay' }
 *       - { in: query, name: to, schema: { type: string, format: date }, description: 'Mặc định hôm nay' }
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 50, default: 10 } }
 *     responses:
 *       200:
 *         description: Danh sách món
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/DashboardTopItems' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/top-items', validate({ query: topItemsQuerySchema }), dashboardController.topItems);

/**
 * @openapi
 * /admin/dashboard/recent-orders:
 *   get:
 *     tags: [Dashboard]
 *     summary: Đơn hàng gần đây (mới nhất trước)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: limit, schema: { type: integer, minimum: 1, maximum: 50, default: 10 } }
 *     responses:
 *       200:
 *         description: Danh sách đơn (cùng định dạng /admin/orders)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: array, items: { $ref: '#/components/schemas/AdminOrder' } }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get(
  '/recent-orders',
  validate({ query: recentOrdersQuerySchema }),
  dashboardController.recentOrders,
);

/**
 * @openapi
 * /admin/dashboard/payment-methods:
 *   get:
 *     tags: [Dashboard]
 *     summary: Tỉ lệ theo phương thức thanh toán
 *     description: Luôn trả đủ các phương thức (cash, bank_transfer, card), sắp theo số tiền giảm dần.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: from, schema: { type: string, format: date }, description: 'Mặc định hôm nay' }
 *       - { in: query, name: to, schema: { type: string, format: date }, description: 'Mặc định hôm nay' }
 *     responses:
 *       200:
 *         description: Tỉ lệ
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/DashboardPaymentMethods' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get(
  '/payment-methods',
  validate({ query: paymentMethodsQuerySchema }),
  dashboardController.paymentMethods,
);

export default router;
