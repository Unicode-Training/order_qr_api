import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { AppError } from '../../utils/AppError';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(
      new AppError(400, 'INVALID_FILE_TYPE', 'Chỉ chấp nhận ảnh JPEG, PNG hoặc WEBP', {
        mimetype: file.mimetype,
      }),
    );
  },
});

/** Kiểm tra chữ ký file (magic bytes) để chặn file giả mạo mimetype. */
export function detectImageType(buffer: Buffer): (typeof ALLOWED_IMAGE_MIME_TYPES)[number] | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Nhận 1 ảnh ở field `file` (multipart/form-data) vào bộ nhớ (không ghi đĩa).
 * Lỗi multer được chuyển thành AppError: quá 5MB → 413 FILE_TOO_LARGE, sai định dạng → 400.
 */
export const singleImageUpload: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      if (!req.file) {
        next(new AppError(400, 'FILE_REQUIRED', 'Vui lòng chọn ảnh (field "file")'));
        return;
      }
      if (detectImageType(req.file.buffer) === null) {
        next(
          new AppError(
            400,
            'INVALID_FILE_TYPE',
            'Nội dung file không phải ảnh JPEG, PNG hoặc WEBP',
          ),
        );
        return;
      }
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(
          new AppError(413, 'FILE_TOO_LARGE', 'Ảnh vượt quá dung lượng cho phép (tối đa 5MB)', {
            maxBytes: MAX_UPLOAD_BYTES,
          }),
        );
        return;
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        next(new AppError(400, 'INVALID_UPLOAD_FIELD', 'Chỉ gửi 1 ảnh ở field "file"'));
        return;
      }
      next(AppError.badRequest(`Upload không hợp lệ: ${err.message}`, { code: err.code }));
      return;
    }
    next(err);
  });
};
