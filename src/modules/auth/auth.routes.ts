import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import * as authController from './auth.controller';
import { createLoginRateLimiter } from './auth.rateLimit';
import { changePasswordSchema, loginSchema, refreshTokenBodySchema } from './auth.schema';

/** Router /api/v1/auth — tạo theo factory để mỗi app có rate limiter riêng. */
export function createAuthRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     tags: [Auth]
   *     summary: Đăng nhập bằng email + mật khẩu
   *     description: |
   *       Trả về access token (Bearer) và refresh token. Giới hạn số lần đăng nhập thất bại theo IP
   *       (`LOGIN_RATE_LIMIT_MAX` lần / `LOGIN_RATE_LIMIT_WINDOW_MINUTES` phút) → 429.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [email, password]
   *             properties:
   *               email: { type: string, format: email, example: admin@example.com }
   *               password: { type: string, format: password, example: change-me-strong-password }
   *     responses:
   *       200:
   *         description: Đăng nhập thành công
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data:
   *                   allOf:
   *                     - $ref: '#/components/schemas/AuthTokens'
   *                     - type: object
   *                       properties:
   *                         user: { $ref: '#/components/schemas/User' }
   *       400: { $ref: '#/components/responses/ValidationError' }
   *       401:
   *         description: Sai email hoặc mật khẩu (INVALID_CREDENTIALS)
   *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
   *       403:
   *         description: Tài khoản đã bị vô hiệu hoá (ACCOUNT_DISABLED)
   *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
   *       429:
   *         description: Đăng nhập sai quá nhiều lần (TOO_MANY_REQUESTS)
   *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
   */
  router.post(
    '/login',
    createLoginRateLimiter(),
    validate({ body: loginSchema }),
    authController.login,
  );

  /**
   * @openapi
   * /auth/refresh:
   *   post:
   *     tags: [Auth]
   *     summary: Lấy cặp token mới bằng refresh token
   *     description: |
   *       Refresh token cũ bị thu hồi ngay sau khi dùng (rotation). Dùng lại một refresh token đã
   *       thu hồi sẽ thu hồi toàn bộ phiên của tài khoản.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RefreshTokenBody' }
   *     responses:
   *       200:
   *         description: Cặp token mới
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { $ref: '#/components/schemas/AuthTokens' }
   *       400: { $ref: '#/components/responses/ValidationError' }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.post('/refresh', validate({ body: refreshTokenBodySchema }), authController.refresh);

  /**
   * @openapi
   * /auth/logout:
   *   post:
   *     tags: [Auth]
   *     summary: Đăng xuất (thu hồi refresh token)
   *     description: Không cần access token. Idempotent — token đã thu hồi/không tồn tại vẫn trả 200.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema: { $ref: '#/components/schemas/RefreshTokenBody' }
   *     responses:
   *       200:
   *         description: Đã đăng xuất (refresh token bị thu hồi; token không tồn tại cũng trả 200)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data:
   *                   type: object
   *                   properties:
   *                     message: { type: string, example: Đã đăng xuất }
   *       400: { $ref: '#/components/responses/ValidationError' }
   */
  router.post('/logout', validate({ body: refreshTokenBodySchema }), authController.logout);

  /**
   * @openapi
   * /auth/me:
   *   get:
   *     tags: [Auth]
   *     summary: Thông tin tài khoản đang đăng nhập
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
   */
  router.get('/me', authenticate, authController.me);

  /**
   * @openapi
   * /auth/me/password:
   *   patch:
   *     tags: [Auth]
   *     summary: Đổi mật khẩu của chính mình
   *     description: Thu hồi mọi refresh token cũ (đăng xuất các thiết bị khác) và trả về cặp token mới.
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [currentPassword, newPassword]
   *             properties:
   *               currentPassword: { type: string, format: password }
   *               newPassword: { type: string, format: password, minLength: 8, maxLength: 72 }
   *     responses:
   *       200:
   *         description: Đổi mật khẩu thành công, kèm cặp token mới
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success: { type: boolean, example: true }
   *                 data: { $ref: '#/components/schemas/AuthTokens' }
   *       400:
   *         description: Dữ liệu không hợp lệ hoặc mật khẩu hiện tại không đúng
   *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
   *       401: { $ref: '#/components/responses/Unauthorized' }
   */
  router.patch(
    '/me/password',
    authenticate,
    validate({ body: changePasswordSchema }),
    authController.changePassword,
  );

  return router;
}
