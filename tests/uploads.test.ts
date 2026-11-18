import supertest from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { Category } from '../src/modules/menu/category.model';
import * as cloudinary from '../src/modules/uploads/cloudinary.service';
import { detectImageType } from '../src/modules/uploads/upload.middleware';
import { AppError } from '../src/utils/AppError';
import { createUser, loginAs } from './helpers/auth';
import { resetCloudinaryMock } from './helpers/cloudinaryMock';
import { setupTestDb } from './helpers/db';

vi.mock('../src/modules/uploads/cloudinary.service', async (importOriginal) => ({
  ...(await importOriginal<typeof cloudinary>()),
  isCloudinaryConfigured: vi.fn(() => true),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
}));

setupTestDb();

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.alloc(32, 1),
]);

describe('Upload ảnh (Cloudinary được mock)', () => {
  let app: ReturnType<typeof createApp>;
  let bearer: string;

  beforeEach(async () => {
    resetCloudinaryMock(cloudinary);
    app = createApp();
    await createUser();
    bearer = `Bearer ${(await loginAs(app)).accessToken}`;
  });

  const post = (query = '?folder=menu-items') =>
    supertest(app).post(`/api/v1/admin/uploads${query}`).set('Authorization', bearer);

  it('detectImageType nhận diện chữ ký file', () => {
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(WEBP)).toBe('image/webp');
    expect(detectImageType(Buffer.from('hello'))).toBeNull();
  });

  it('yêu cầu đăng nhập', async () => {
    const res = await supertest(app)
      .post('/api/v1/admin/uploads?folder=menu-items')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
    const del = await supertest(app).delete('/api/v1/admin/uploads/order-qr%2Fmenu-items%2Fa');
    expect(del.status).toBe(401);
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it.each([
    ['png', PNG, 'image/png'],
    ['jpg', JPEG, 'image/jpeg'],
    ['webp', WEBP, 'image/webp'],
  ])('upload %s thành công → {url, publicId, width, height}', async (ext, buffer, contentType) => {
    const res = await post().attach('file', buffer, { filename: `a.${ext}`, contentType });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data).toEqual({
      url: expect.stringMatching(/^https:\/\/res\.cloudinary\.com\//),
      publicId: expect.stringMatching(/^order-qr\/menu-items\//),
      width: 800,
      height: 600,
    });
    expect(cloudinary.uploadImage).toHaveBeenCalledWith(expect.any(Buffer), 'menu-items');
    const sent = vi.mocked(cloudinary.uploadImage).mock.calls[0]?.[0];
    expect(sent?.equals(buffer)).toBe(true);
  });

  it('nhận folder qua field form', async () => {
    const res = await post('')
      .field('folder', 'categories')
      .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(cloudinary.uploadImage).toHaveBeenCalledWith(expect.any(Buffer), 'categories');
  });

  it('folder thiếu hoặc không hợp lệ → 400', async () => {
    const missing = await post('').attach('file', PNG, {
      filename: 'a.png',
      contentType: 'image/png',
    });
    expect(missing.status).toBe(400);
    const bad = await post('?folder=../etc').attach('file', PNG, {
      filename: 'a.png',
      contentType: 'image/png',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe('folder');
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('từ chối mimetype không cho phép (gif, pdf) → 400 INVALID_FILE_TYPE', async () => {
    for (const [name, type] of [
      ['a.gif', 'image/gif'],
      ['a.pdf', 'application/pdf'],
    ]) {
      const res = await post().attach('file', PNG, { filename: name, contentType: type });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
    }
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('từ chối file giả mạo mimetype (nội dung không phải ảnh)', async () => {
    const res = await post().attach('file', Buffer.from('<?php echo 1; ?>'), {
      filename: 'a.png',
      contentType: 'image/png',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  it('từ chối file quá 5MB → 413 FILE_TOO_LARGE', async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024, 0)]);
    const res = await post().attach('file', big, {
      filename: 'big.jpg',
      contentType: 'image/jpeg',
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('thiếu file hoặc sai tên field → 400', async () => {
    const none = await post().field('foo', 'bar');
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('FILE_REQUIRED');
    const wrongField = await post().attach('image', PNG, {
      filename: 'a.png',
      contentType: 'image/png',
    });
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error.code).toBe('INVALID_UPLOAD_FIELD');
  });

  it('Cloudinary chưa cấu hình → 503', async () => {
    vi.mocked(cloudinary.uploadImage).mockRejectedValueOnce(
      AppError.serviceUnavailable('Chưa cấu hình Cloudinary'),
    );
    const res = await post().attach('file', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
  });

  describe('DELETE /admin/uploads/:publicId', () => {
    it('xoá ảnh (publicId được encode)', async () => {
      const res = await supertest(app)
        .delete(`/api/v1/admin/uploads/${encodeURIComponent('order-qr/menu-items/abc')}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ deleted: true });
      expect(cloudinary.deleteImage).toHaveBeenCalledWith('order-qr/menu-items/abc');
    });

    it('từ chối publicId ngoài thư mục ứng dụng', async () => {
      const res = await supertest(app)
        .delete(`/api/v1/admin/uploads/${encodeURIComponent('other/abc')}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(400);
      expect(cloudinary.deleteImage).not.toHaveBeenCalled();
    });

    it('ảnh đang được dùng → 409 IMAGE_IN_USE', async () => {
      await Category.create({
        name: 'A',
        slug: 'a',
        image: { url: 'https://res.cloudinary.com/x.jpg', publicId: 'order-qr/categories/used' },
      });
      const res = await supertest(app)
        .delete(`/api/v1/admin/uploads/${encodeURIComponent('order-qr/categories/used')}`)
        .set('Authorization', bearer);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({
        code: 'IMAGE_IN_USE',
        details: { usage: ['category'] },
      });
      expect(cloudinary.deleteImage).not.toHaveBeenCalled();
    });
  });

  it('đổi logo nhà hàng → xoá logo cũ trên Cloudinary', async () => {
    const logo = (id: string) => ({
      url: `https://res.cloudinary.com/demo/${id}.png`,
      publicId: id,
    });
    await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ logo: logo('order-qr/restaurant/old') })
      .expect(200);
    expect(cloudinary.deleteImage).not.toHaveBeenCalled();
    await supertest(app)
      .patch('/api/v1/admin/settings')
      .set('Authorization', bearer)
      .send({ logo: logo('order-qr/restaurant/new') })
      .expect(200);
    expect(cloudinary.deleteImage).toHaveBeenCalledWith('order-qr/restaurant/old');
  });
});
