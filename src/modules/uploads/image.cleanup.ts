import { logger } from '../../utils/logger';
import { deleteImage, isCloudinaryConfigured } from './cloudinary.service';

export interface StoredImage {
  url: string;
  publicId?: string | null;
}

/**
 * Xoá ảnh cũ trên Cloudinary ở chế độ "chạy nền": không chờ, lỗi chỉ ghi log,
 * không bao giờ làm hỏng request đang xử lý.
 */
export function deleteImageQuietly(publicId: string | null | undefined): void {
  if (!publicId) return;
  if (!isCloudinaryConfigured()) {
    logger.warn(`Chưa cấu hình Cloudinary, bỏ qua xoá ảnh "${publicId}"`);
    return;
  }
  try {
    void Promise.resolve(deleteImage(publicId)).catch((err: unknown) => {
      logger.error(`Không xoá được ảnh Cloudinary "${publicId}"`, err);
    });
  } catch (err) {
    logger.error(`Không xoá được ảnh Cloudinary "${publicId}"`, err);
  }
}

/** Xoá ảnh cũ nếu ảnh đã bị thay (publicId khác) hoặc bị gỡ. */
export function cleanupReplacedImage(
  previous: StoredImage | null | undefined,
  next: StoredImage | null | undefined,
): void {
  const oldId = previous?.publicId;
  if (oldId && oldId !== next?.publicId) deleteImageQuietly(oldId);
}
