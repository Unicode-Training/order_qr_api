import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';

/** Thư mục con được phép upload (dưới CLOUDINARY_FOLDER). */
export const UPLOAD_FOLDERS = ['menu-items', 'categories', 'restaurant'] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

export interface UploadedImage {
  /** `secure_url` (https) của ảnh. */
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

/** Giới hạn chiều rộng khi lưu (incoming transformation) — ảnh lớn hơn sẽ bị thu nhỏ. */
const MAX_IMAGE_WIDTH = 1200;

let configured = false;

export function isCloudinaryConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

function ensureConfigured(): void {
  if (!isCloudinaryConfigured()) {
    throw AppError.serviceUnavailable('Chưa cấu hình Cloudinary (CLOUDINARY_* trong .env)');
  }
  if (configured) return;
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

/** Thư mục đầy đủ trên Cloudinary, vd. `order-qr/menu-items`. */
export function resolveFolder(subfolder: UploadFolder): string {
  return `${env.CLOUDINARY_FOLDER}/${subfolder}`;
}

/** publicId có thuộc thư mục của ứng dụng không (chặn xoá ảnh ngoài phạm vi). */
export function isManagedPublicId(publicId: string): boolean {
  return publicId.startsWith(`${env.CLOUDINARY_FOLDER}/`) && !publicId.includes('..');
}

export interface UploadImageOptions {
  /**
   * Tên ảnh cố định trong thư mục (vd. `demo-tiramisu`) thay vì tên ngẫu nhiên. Ảnh cùng tên đã có
   * thì Cloudinary trả lại ảnh đó, không ghi đè (`overwrite: false`) — dùng cho seed idempotent.
   */
  publicId?: string;
}

/** Upload ảnh từ buffer (không lưu file local) bằng `upload_stream`. */
export async function uploadImage(
  buffer: Buffer,
  subfolder: UploadFolder,
  options: UploadImageOptions = {},
): Promise<UploadedImage> {
  ensureConfigured();
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: resolveFolder(subfolder),
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        transformation: [{ width: MAX_IMAGE_WIDTH, crop: 'limit', quality: 'auto' }],
        ...(options.publicId ? { public_id: options.publicId, overwrite: false } : {}),
      },
      (error, response) => {
        if (error || !response) reject(error ?? new Error('Cloudinary không trả kết quả'));
        else resolve(response);
      },
    );
    stream.end(buffer);
  }).catch((err: unknown) => {
    logger.error('Upload ảnh lên Cloudinary thất bại', err);
    throw new AppError(502, 'UPLOAD_FAILED', 'Không upload được ảnh, vui lòng thử lại');
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.bytes,
  };
}

/** Xoá ảnh trên Cloudinary. Trả `true` nếu đã xoá, `false` nếu ảnh không tồn tại. */
export async function deleteImage(publicId: string): Promise<boolean> {
  ensureConfigured();
  const result = (await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true,
  })) as { result?: string };
  if (result.result === 'ok') return true;
  if (result.result === 'not found') return false;
  throw new Error(`Cloudinary destroy trả về: ${result.result ?? 'unknown'}`);
}
