import { z } from 'zod';
import { UPLOAD_FOLDERS } from './cloudinary.service';

export const uploadFolderSchema = z.enum(UPLOAD_FOLDERS, {
  error: `folder phải là một trong: ${UPLOAD_FOLDERS.join(', ')}`,
});

export const deleteUploadParamsSchema = z.object({
  publicId: z.string().trim().min(1).max(255),
});
