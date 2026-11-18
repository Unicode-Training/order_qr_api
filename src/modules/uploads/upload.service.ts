import { AppError } from '../../utils/AppError';
import { Category } from '../menu/category.model';
import { MenuItem } from '../menu/menuItem.model';
import { RestaurantSettings } from '../settings/settings.model';
import {
  deleteImage,
  isManagedPublicId,
  uploadImage,
  type UploadedImage,
  type UploadFolder,
} from './cloudinary.service';

export function uploadMenuImage(buffer: Buffer, folder: UploadFolder): Promise<UploadedImage> {
  return uploadImage(buffer, folder);
}

/** Ảnh có đang được món/danh mục/cài đặt nhà hàng dùng không. */
export async function findImageUsage(publicId: string): Promise<string[]> {
  const [item, category, settings] = await Promise.all([
    MenuItem.exists({ 'image.publicId': publicId }),
    Category.exists({ 'image.publicId': publicId }),
    RestaurantSettings.exists({
      $or: [{ 'logo.publicId': publicId }, { 'coverImage.publicId': publicId }],
    }),
  ]);
  const usage: string[] = [];
  if (item) usage.push('menu-item');
  if (category) usage.push('category');
  if (settings) usage.push('restaurant');
  return usage;
}

/**
 * Xoá ảnh đã upload (vd. khách huỷ form sau khi upload). Chỉ xoá ảnh trong thư mục ứng dụng
 * và chưa được dùng ở đâu (ảnh đang dùng sẽ tự xoá khi đổi ảnh/xoá món).
 */
export async function removeUploadedImage(publicId: string): Promise<{ deleted: boolean }> {
  if (!isManagedPublicId(publicId)) {
    throw AppError.badRequest('publicId không thuộc thư mục ảnh của ứng dụng', { publicId });
  }
  const usage = await findImageUsage(publicId);
  if (usage.length > 0) {
    throw new AppError(409, 'IMAGE_IN_USE', 'Ảnh đang được sử dụng, không thể xoá', { usage });
  }
  try {
    return { deleted: await deleteImage(publicId) };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      502,
      'DELETE_FAILED',
      'Không xoá được ảnh trên Cloudinary, vui lòng thử lại',
    );
  }
}
