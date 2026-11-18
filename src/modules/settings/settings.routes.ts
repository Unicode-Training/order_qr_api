import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import * as settingsController from './settings.controller';
import { patchSettingsSchema, restaurantSettingsSchema } from './settings.schema';

/**
 * Thông tin nhà hàng công khai — gắn dưới /api/v1/public/restaurant (không cần đăng nhập).
 */
export const publicRestaurantRouter = Router();

/**
 * @openapi
 * /public/restaurant:
 *   get:
 *     tags: [Restaurant]
 *     summary: Thông tin nhà hàng công khai cho khách
 *     description: |
 *       Không chứa trường nội bộ (publicId ảnh, id document...). `isOpenNow` tính theo `openingHours`
 *       và múi giờ Asia/Ho_Chi_Minh. `ordering.canOrderNow` = `ordering.enabled` và
 *       (đang mở cửa hoặc `allowOrderOutsideOpeningHours`). `bankTransferInfo` chỉ có khi bật `bank_transfer`.
 *     responses:
 *       200:
 *         description: Thông tin nhà hàng
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/PublicRestaurant' }
 */
publicRestaurantRouter.get('/', settingsController.getPublic);

/**
 * Cài đặt nhà hàng — gắn dưới /api/v1/admin/settings (đã qua `authenticate`).
 */
export const adminSettingsRouter = Router();

/**
 * @openapi
 * /admin/settings:
 *   get:
 *     tags: [Settings]
 *     summary: Lấy toàn bộ cài đặt nhà hàng
 *     description: Nếu chưa có cài đặt, hệ thống tự tạo với giá trị mặc định.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Cài đặt hiện tại
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/RestaurantSettings' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   put:
 *     tags: [Settings]
 *     summary: Thay toàn bộ cài đặt
 *     description: Chỉ `name` bắt buộc; trường bị bỏ qua sẽ nhận giá trị mặc định.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RestaurantSettingsInput' }
 *     responses:
 *       200:
 *         description: Đã cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/RestaurantSettings' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   patch:
 *     tags: [Settings]
 *     summary: Cập nhật một phần cài đặt
 *     description: |
 *       - Object lồng nhau (`ordering`, `wifi`, `logo`, `coverImage`, `bankTransferInfo`) được gộp:
 *         chỉ các trường gửi lên bị ghi đè. Gửi `null` để xoá (wifi, logo, coverImage, bankTransferInfo).
 *       - Mảng (`openingHours`, `paymentMethods`) bị thay thế toàn bộ.
 *       - Sau khi gộp, toàn bộ cài đặt được validate lại (vd. bật `bank_transfer` mà chưa có `bankTransferInfo` → 400).
 *       - Cần ít nhất một trường hợp lệ; trường lạ bị bỏ qua.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RestaurantSettingsPatch' }
 *           example: { vatPercent: 8, ordering: { requireStaffConfirm: false } }
 *     responses:
 *       200:
 *         description: Đã cập nhật
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/RestaurantSettings' }
 *       400: { $ref: '#/components/responses/ValidationError' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
adminSettingsRouter.get('/', settingsController.get);
adminSettingsRouter.put(
  '/',
  validate({ body: restaurantSettingsSchema }),
  settingsController.replace,
);
adminSettingsRouter.patch('/', validate({ body: patchSettingsSchema }), settingsController.patch);
