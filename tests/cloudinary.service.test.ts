import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Không gọi mạng: mock toàn bộ SDK cloudinary.
const sdk = vi.hoisted(() => {
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  process.env.CLOUDINARY_FOLDER = '/my-shop/';
  return { config: vi.fn(), upload_stream: vi.fn(), destroy: vi.fn() };
});

vi.mock('cloudinary', () => ({
  v2: { config: sdk.config, uploader: { upload_stream: sdk.upload_stream, destroy: sdk.destroy } },
}));

import { env } from '../src/config/env';
import {
  deleteImage,
  isManagedPublicId,
  resolveFolder,
  uploadImage,
} from '../src/modules/uploads/cloudinary.service';

type Callback = (error: unknown, result?: Record<string, unknown>) => void;

describe('cloudinary.service', () => {
  beforeEach(() => {
    sdk.upload_stream.mockReset();
    sdk.destroy.mockReset();
    env.CLOUDINARY_API_KEY = 'key';
  });

  it('chuẩn hoá CLOUDINARY_FOLDER và kiểm tra publicId thuộc thư mục', () => {
    expect(env.CLOUDINARY_FOLDER).toBe('my-shop');
    expect(resolveFolder('menu-items')).toBe('my-shop/menu-items');
    expect(isManagedPublicId('my-shop/menu-items/a')).toBe(true);
    expect(isManagedPublicId('other/a')).toBe(false);
    expect(isManagedPublicId('my-shop/../x')).toBe(false);
  });

  it('uploadImage dùng upload_stream với folder + transformation, trả secure_url', async () => {
    let written: Buffer | undefined;
    sdk.upload_stream.mockImplementation((_options: unknown, cb: Callback) => {
      const chunks: Buffer[] = [];
      return new Writable({
        write(chunk: Buffer, _enc, done) {
          chunks.push(chunk);
          done();
        },
        final(done) {
          written = Buffer.concat(chunks);
          cb(undefined, {
            secure_url: 'https://res.cloudinary.com/demo/a.jpg',
            public_id: 'my-shop/menu-items/a',
            width: 1200,
            height: 800,
            format: 'jpg',
            bytes: 10,
          });
          done();
        },
      });
    });

    const result = await uploadImage(Buffer.from('abc'), 'menu-items');
    expect(result).toEqual({
      url: 'https://res.cloudinary.com/demo/a.jpg',
      publicId: 'my-shop/menu-items/a',
      width: 1200,
      height: 800,
      format: 'jpg',
      bytes: 10,
    });
    expect(written?.toString()).toBe('abc');
    expect(sdk.config).toHaveBeenCalledWith(
      expect.objectContaining({ cloud_name: 'demo', api_key: 'key', secure: true }),
    );
    expect(sdk.upload_stream.mock.calls[0]?.[0]).toMatchObject({
      folder: 'my-shop/menu-items',
      resource_type: 'image',
      transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
    });
  });

  it('uploadImage lỗi từ Cloudinary → AppError 502 UPLOAD_FAILED', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sdk.upload_stream.mockImplementation((_options: unknown, cb: Callback) => {
      return new Writable({
        write(_chunk, _enc, done) {
          done();
        },
        final(done) {
          cb(new Error('boom'));
          done();
        },
      });
    });
    await expect(uploadImage(Buffer.from('x'), 'categories')).rejects.toMatchObject({
      statusCode: 502,
      code: 'UPLOAD_FAILED',
    });
    spy.mockRestore();
  });

  it('chưa cấu hình → 503', async () => {
    env.CLOUDINARY_API_KEY = '';
    await expect(uploadImage(Buffer.from('x'), 'categories')).rejects.toMatchObject({
      statusCode: 503,
    });
    await expect(deleteImage('my-shop/a')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('deleteImage: ok → true, not found → false, khác → lỗi', async () => {
    sdk.destroy.mockResolvedValueOnce({ result: 'ok' });
    await expect(deleteImage('my-shop/a')).resolves.toBe(true);
    expect(sdk.destroy).toHaveBeenCalledWith(
      'my-shop/a',
      expect.objectContaining({ invalidate: true }),
    );
    sdk.destroy.mockResolvedValueOnce({ result: 'not found' });
    await expect(deleteImage('my-shop/a')).resolves.toBe(false);
    sdk.destroy.mockResolvedValueOnce({ result: 'error' });
    await expect(deleteImage('my-shop/a')).rejects.toThrow();
  });
});
