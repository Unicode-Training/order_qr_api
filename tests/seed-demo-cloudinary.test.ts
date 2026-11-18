import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Có cấu hình Cloudinary → seed tải ảnh nguồn rồi upload. Không gọi mạng: mock SDK + fetch.
const sdk = vi.hoisted(() => {
  process.env.CLOUDINARY_CLOUD_NAME = 'demo';
  process.env.CLOUDINARY_API_KEY = 'key';
  process.env.CLOUDINARY_API_SECRET = 'secret';
  process.env.CLOUDINARY_FOLDER = 'shop';
  return { config: vi.fn(), upload_stream: vi.fn(), destroy: vi.fn() };
});

vi.mock('cloudinary', () => ({
  v2: { config: sdk.config, uploader: { upload_stream: sdk.upload_stream, destroy: sdk.destroy } },
}));

import { Category } from '../src/modules/menu/category.model';
import { MenuItem } from '../src/modules/menu/menuItem.model';
import { getSettings } from '../src/modules/settings/settings.service';
import { DEMO_CATEGORIES, DEMO_MENU_ITEMS, seedDemo } from '../src/scripts/seed-demo';
import { setupTestDb } from './helpers/db';

setupTestDb();

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
type Callback = (error: unknown, result?: Record<string, unknown>) => void;

describe('seedDemo + Cloudinary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sdk.upload_stream.mockReset();
  });

  it('tải ảnh nguồn, upload với publicId cố định (overwrite: false)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input).includes('Tiramisu')
          ? new Response('<html>', { status: 200 })
          : new Response(JPEG, { status: 200 }),
      );
    const options: Record<string, unknown>[] = [];
    sdk.upload_stream.mockImplementation((opts: Record<string, unknown>, cb: Callback) => {
      options.push(opts);
      return new Writable({
        write(_chunk, _enc, done) {
          done();
        },
        final(done) {
          const publicId = `${String(opts.folder)}/${String(opts.public_id)}`;
          cb(undefined, {
            secure_url: `https://res.cloudinary.com/demo/${publicId}.jpg`,
            public_id: publicId,
            width: 960,
            height: 640,
            format: 'jpg',
            bytes: 6,
          });
          done();
        },
      });
    });

    const result = await seedDemo({ now: new Date('2026-11-18T07:00:00.000Z') });
    const total = 2 + DEMO_CATEGORIES.length + DEMO_MENU_ITEMS.length;
    // Tiramisu trả về không phải ảnh → lỗi, giữ null
    expect(result.images).toEqual({ mode: 'cloudinary', applied: total - 1, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(total);
    expect(options).toHaveLength(total - 1);
    expect(options).toContainEqual(
      expect.objectContaining({
        folder: 'shop/menu-items',
        public_id: 'demo-pizza-margherita',
        overwrite: false,
      }),
    );

    expect((await getSettings()).logo).toEqual({
      url: 'https://res.cloudinary.com/demo/shop/restaurant/demo-logo.jpg',
      publicId: 'shop/restaurant/demo-logo',
    });
    expect((await Category.findOne({ slug: 'khai-vi' }).lean())!.image?.publicId).toBe(
      'shop/categories/demo-khai-vi',
    );
    expect((await MenuItem.findOne({ slug: 'tiramisu' }).lean())!.image).toBeNull();
  });
});
