import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import { sendCreated, sendSuccess } from '../../utils/response';
import { uploadFolderSchema } from './upload.schema';
import * as uploadService from './upload.service';

export async function upload(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawFolder = req.query.folder ?? body.folder;
  const parsed = uploadFolderSchema.safeParse(rawFolder);
  if (!parsed.success) {
    throw AppError.validation('Dữ liệu không hợp lệ', [
      {
        location: req.query.folder !== undefined ? 'query' : 'body',
        path: 'folder',
        message: parsed.error.issues[0]?.message ?? 'folder không hợp lệ',
        code: 'invalid_value',
      },
    ]);
  }
  const file = req.file;
  if (!file) throw new AppError(400, 'FILE_REQUIRED', 'Vui lòng chọn ảnh (field "file")');

  const image = await uploadService.uploadMenuImage(file.buffer, parsed.data);
  logger.info(`Đã upload ảnh ${image.publicId} (${image.bytes} bytes)`);
  sendCreated(res, {
    url: image.url,
    publicId: image.publicId,
    width: image.width,
    height: image.height,
  });
}

export async function remove(req: Request<{ publicId: string }>, res: Response): Promise<void> {
  sendSuccess(res, await uploadService.removeUploadedImage(req.params.publicId));
}
