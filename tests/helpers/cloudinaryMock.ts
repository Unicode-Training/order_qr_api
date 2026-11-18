import { vi } from 'vitest';
import type { UploadedImage, UploadFolder } from '../../src/modules/uploads/cloudinary.service';

let counter = 0;

/** Kết quả giả của uploadImage (không gọi mạng). */
export function fakeUploadResult(folder: UploadFolder): UploadedImage {
  counter += 1;
  const publicId = `order-qr/${folder}/fake-${counter}`;
  return {
    url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.jpg`,
    publicId,
    width: 800,
    height: 600,
    format: 'jpg',
    bytes: 1234,
  };
}

/** Đợi các promise "chạy nền" (xoá ảnh) hoàn tất. */
export const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

export function resetCloudinaryMock(mod: { uploadImage: unknown; deleteImage: unknown }): void {
  vi.mocked(mod.uploadImage as (b: Buffer, f: UploadFolder) => Promise<UploadedImage>)
    .mockReset()
    .mockImplementation(async (_buffer, folder) => fakeUploadResult(folder));
  vi.mocked(mod.deleteImage as (id: string) => Promise<boolean>)
    .mockReset()
    .mockResolvedValue(true);
}
