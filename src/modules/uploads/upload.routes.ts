import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import * as uploadController from './upload.controller';
import { singleImageUpload } from './upload.middleware';
import { deleteUploadParamsSchema } from './upload.schema';

/** Upload ảnh lên Cloudinary — gắn dưới /api/v1/admin/uploads (đã qua `authenticate`). */
const router = Router();

/**
 * @openapi
 * /admin/uploads:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload ảnh lên Cloudinary
 *     description: |
 *       Gửi `multipart/form-data` với field `file` (JPEG/PNG/WEBP, tối đa 5MB) và `folder`
 *       (query hoặc field form). Ảnh được lưu vào `<CLOUDINARY_FOLDER>/<folder>`, chiều rộng tối đa 1200px.
 *       Dùng `{url, publicId}` trả về cho trường `image` của món/danh mục hoặc `logo`/`coverImage` của nhà hàng.
 *       Khi đổi ảnh hoặc xoá món/danh mục, ảnh cũ tự động bị xoá trên Cloudinary.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: folder, schema: { type: string, enum: [menu-items, categories, restaurant] } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *               folder: { type: string, enum: [menu-items, categories, restaurant] }
 *     responses:
 *       201:
 *         description: Đã upload
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { $ref: '#/components/schemas/UploadedImage' }
 *       400:
 *         description: Thiếu file (FILE_REQUIRED), sai định dạng (INVALID_FILE_TYPE), gửi nhiều file / sai tên field (INVALID_UPLOAD_FIELD) hoặc folder không hợp lệ (VALIDATION_ERROR)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       413:
 *         description: Ảnh vượt quá 5MB (FILE_TOO_LARGE)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       502:
 *         description: Cloudinary lỗi (UPLOAD_FAILED)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       503:
 *         description: Chưa cấu hình Cloudinary (SERVICE_UNAVAILABLE)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
router.post('/', singleImageUpload, uploadController.upload);

/**
 * @openapi
 * /admin/uploads/{publicId}:
 *   delete:
 *     tags: [Uploads]
 *     summary: Xoá ảnh đã upload (chưa được sử dụng)
 *     description: |
 *       `publicId` phải được encode (`encodeURIComponent`, vd. `order-qr%2Fmenu-items%2Fabc`).
 *       Chỉ xoá ảnh trong thư mục CLOUDINARY_FOLDER. Ảnh đang được món/danh mục/nhà hàng dùng → 409 IMAGE_IN_USE.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: publicId, required: true, schema: { type: string, example: order-qr%2Fmenu-items%2Fabc123 } }
 *     responses:
 *       200:
 *         description: Kết quả xoá (`deleted=false` nếu ảnh không tồn tại)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object, properties: { deleted: { type: boolean } } }
 *       400:
 *         description: publicId không hợp lệ (VALIDATION_ERROR) hoặc không thuộc thư mục ảnh của ứng dụng (BAD_REQUEST)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409:
 *         description: Ảnh đang được sử dụng (IMAGE_IN_USE, `details.usage` = nơi đang dùng)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       502:
 *         description: Cloudinary lỗi khi xoá (DELETE_FAILED)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 *       503:
 *         description: Chưa cấu hình Cloudinary (SERVICE_UNAVAILABLE)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
 */
router.delete(
  '/:publicId',
  validate({ params: deleteUploadParamsSchema }),
  uploadController.remove,
);

export default router;
