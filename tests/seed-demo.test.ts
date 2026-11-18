import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Area } from '../src/modules/areas/area.model';
import { Category } from '../src/modules/menu/category.model';
import { MenuItem } from '../src/modules/menu/menuItem.model';
import { Order } from '../src/modules/orders/order.model';
import { nextOrderNumber, toBusinessDate } from '../src/modules/orders/order.service';
import { Payment } from '../src/modules/payments/payment.model';
import { ServiceRequest } from '../src/modules/serviceRequests/serviceRequest.model';
import { TableSession } from '../src/modules/sessions/tableSession.model';
import { getSettings, patchSettings } from '../src/modules/settings/settings.service';
import { Table } from '../src/modules/tables/table.model';
import { User } from '../src/modules/users/user.model';
import {
  DEMO_CATEGORY_IMAGES,
  DEMO_MENU_ITEM_IMAGES,
  wikimediaImageUrl,
} from '../src/scripts/demoImages';
import {
  DEFAULT_DEMO_PASSWORD,
  DEMO_CATEGORIES,
  DEMO_MENU_ITEMS,
  DEMO_RESTAURANT_NAME,
  DEMO_STAFF,
  parseSeedDemoArgs,
  seedDemo,
} from '../src/scripts/seed-demo';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

// 14:00 giờ VN — đủ muộn để hôm nay đã có phiên thanh toán xong.
const NOW = new Date('2026-11-18T07:00:00.000Z');

describe('parseSeedDemoArgs', () => {
  it('nhận --reset/--yes, từ chối tham số lạ', () => {
    expect(parseSeedDemoArgs([])).toEqual({ reset: false, yes: false, images: true });
    expect(parseSeedDemoArgs(['--reset', '--yes'])).toEqual({
      reset: true,
      yes: true,
      images: true,
    });
    expect(parseSeedDemoArgs(['--no-images'])).toMatchObject({ images: false });
    expect(() => parseSeedDemoArgs(['--force'])).toThrow(/--force/);
  });
});

describe('seedDemo', () => {
  it('tạo đủ dữ liệu mẫu nhất quán', async () => {
    const result = await seedDemo({ now: NOW });
    expect(result.settingsApplied).toBe(true);
    expect(result.created).toEqual({
      areas: 3,
      tables: 20,
      categories: 5,
      menuItems: DEMO_MENU_ITEMS.length,
      staff: DEMO_STAFF.length,
    });
    expect(result.history.generated).toBe(true);
    expect(result.history.payments).toBeGreaterThan(100);

    const settings = await getSettings();
    expect(settings).toMatchObject({ name: DEMO_RESTAURANT_NAME, currency: 'VND', vatPercent: 8 });
    expect(await Area.countDocuments()).toBe(3);
    expect(await Table.countDocuments()).toBe(20);
    expect(await Category.countDocuments()).toBe(5);
    expect(await MenuItem.countDocuments()).toBeGreaterThanOrEqual(20);
    for (const item of await MenuItem.find().lean()) {
      expect(Number.isInteger(item.price)).toBe(true);
    }

    // Mỗi phiên đóng có đúng 1 thanh toán, tổng khớp các đơn không huỷ
    const payments = await Payment.find().lean();
    const closed = await TableSession.countDocuments({ status: 'closed' });
    expect(payments).toHaveLength(closed);
    for (const payment of payments.slice(0, 20)) {
      const orders = await Order.find({ _id: { $in: payment.orderIds } }).lean();
      expect(orders.every((o) => o.status === 'served')).toBe(true);
      expect(orders.reduce((s, o) => s + o.subtotal, 0)).toBe(payment.subtotal);
      expect(payment.total).toBe(payment.subtotal + payment.serviceCharge + payment.vat);
      expect(payment.paidAt.getTime()).toBeLessThan(NOW.getTime());
    }

    // Bàn đang có khách ↔ phiên chưa đóng; tối đa 1 phiên mở / bàn
    const active = await TableSession.find({ isActive: true }).lean();
    expect(active).toHaveLength(result.history.activeSessions);
    for (const session of active) {
      const table = await Table.findById(session.tableId).lean();
      expect(table!.status).toBe(
        session.status === 'payment_requested' ? 'needs_payment' : 'occupied',
      );
    }
    expect(await Table.countDocuments({ status: 'reserved' })).toBe(1);
    expect(await ServiceRequest.countDocuments({ status: 'pending' })).toBeGreaterThan(0);

    // Số đơn duy nhất theo ngày, createdAt giữ nguyên lịch sử
    const days = await Order.distinct('businessDate');
    expect(days.length).toBeGreaterThanOrEqual(14);
    const oldest = await Order.findOne().sort({ createdAt: 1 }).lean();
    expect(oldest!.createdAt.getTime()).toBeLessThan(NOW.getTime() - 13 * 86_400_000);
  });

  it('idempotent: chạy lại không tạo trùng, không ghi đè cài đặt đã sửa', async () => {
    await seedDemo({ now: NOW });
    await patchSettings({ name: 'Quán của tôi' });
    const counts = async () => ({
      tables: await Table.countDocuments(),
      items: await MenuItem.countDocuments(),
      orders: await Order.countDocuments(),
      payments: await Payment.countDocuments(),
      users: await User.countDocuments(),
    });
    const before = await counts();

    const again = await seedDemo({ now: NOW });
    expect(again.settingsApplied).toBe(false);
    expect(again.created).toEqual({ areas: 0, tables: 0, categories: 0, menuItems: 0, staff: 0 });
    expect(again.history.generated).toBe(false);
    expect(await counts()).toEqual(before);
    expect((await getSettings()).name).toBe('Quán của tôi');
  });

  it('--reset: xoá và tạo lại, giữ tài khoản không phải demo', async () => {
    await createUser({ email: 'owner@example.com' });
    await seedDemo({ now: NOW });
    await Table.create({ code: 'EXTRA', name: 'Bàn phụ' });

    const result = await seedDemo({ now: NOW, reset: true });
    expect(result.created.tables).toBe(20);
    expect(result.history.generated).toBe(true);
    expect(await Table.exists({ code: 'EXTRA' })).toBeNull();
    expect(await User.exists({ email: 'owner@example.com' })).not.toBeNull();
    expect(await User.countDocuments()).toBe(DEMO_STAFF.length + 1);
  });

  it('dashboard có số liệu, nhân viên demo đăng nhập được, đơn mới không trùng số', async () => {
    await seedDemo({ now: NOW });
    const app = createApp();
    const { accessToken } = await loginAs(app, DEMO_STAFF[0].email, DEFAULT_DEMO_PASSWORD);
    const auth = `Bearer ${accessToken}`;
    const today = toBusinessDate(NOW);

    const summary = await supertest(app)
      .get(`/api/v1/admin/dashboard/summary?date=${today}`)
      .set('Authorization', auth);
    expect(summary.status).toBe(200);
    expect(summary.body.data.revenue.today).toBeGreaterThan(0);
    expect(summary.body.data.revenue.yesterday).toBeGreaterThan(0);
    expect(summary.body.data.tables).toMatchObject({ serving: 5, needsPayment: 1, total: 20 });
    expect(summary.body.data.serviceTime.averageMinutes).toBeGreaterThan(0);

    const top = await supertest(app)
      .get('/api/v1/admin/dashboard/top-items')
      .set('Authorization', auth);
    expect(top.status).toBe(200);
    expect(JSON.stringify(top.body.data).length).toBeGreaterThan(50);

    // Đơn mới hôm nay tiếp nối bộ đếm (không trùng unique businessDate+orderNumber)
    const todayCount = await Order.countDocuments({ businessDate: today });
    expect(await nextOrderNumber(today)).toBe(`ORD-${String(todayCount + 1).padStart(4, '0')}`);
  });

  it('gắn ảnh cho mọi tài nguyên có ảnh (không cấu hình Cloudinary → lưu URL nguồn)', async () => {
    const result = await seedDemo({ now: NOW });
    const expected = 2 + DEMO_CATEGORIES.length + DEMO_MENU_ITEMS.length;
    expect(result.images).toEqual({ mode: 'link', applied: expected, failed: 0 });

    const settings = await getSettings();
    expect(settings.logo).toEqual({ url: expect.stringMatching(/^https:\/\//), publicId: null });
    expect(settings.coverImage?.url).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    for (const category of await Category.find().lean()) {
      expect(category.image?.url).toBe(wikimediaImageUrl(DEMO_CATEGORY_IMAGES[category.slug]!));
    }
    for (const item of await MenuItem.find().lean()) {
      expect(item.image?.url).toBe(wikimediaImageUrl(DEMO_MENU_ITEM_IMAGES[item.slug]!));
      expect(item.image?.publicId).toBeNull();
    }

    // API khách thấy ảnh (không lộ publicId)
    const app = createApp();
    const menu = await supertest(app).get('/api/v1/public/menu');
    const firstItem = JSON.stringify(menu.body.data);
    expect(firstItem).toContain('upload.wikimedia.org');
    expect(firstItem).not.toContain('publicId');
    const restaurant = await supertest(app).get('/api/v1/public/restaurant');
    expect(restaurant.body.data.logo.url).toBe(settings.logo!.url);

    // Chạy lại: không gắn thêm
    expect((await seedDemo({ now: NOW })).images.applied).toBe(0);
  });

  it('mỗi món/danh mục demo đều có nguồn ảnh, URL Wikimedia đúng định dạng', () => {
    for (const def of DEMO_CATEGORIES) expect(DEMO_CATEGORY_IMAGES[def.slug]).toBeDefined();
    for (const def of DEMO_MENU_ITEMS) expect(DEMO_MENU_ITEM_IMAGES[def.slug]).toBeDefined();
    expect(wikimediaImageUrl({ file: 'Tiramisu dessert.jpg', license: 'x' })).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Tiramisu_dessert.jpg/960px-Tiramisu_dessert.jpg',
    );
    expect(wikimediaImageUrl({ file: 'Gỏi cuốn.jpg', license: 'x', width: null })).toBe(
      'https://upload.wikimedia.org/wikipedia/commons/9/90/G%E1%BB%8Fi_cu%E1%BB%91n.jpg',
    );
  });

  it('không ghi đè ảnh đã có, bỏ qua nhà hàng không phải demo, ảnh lỗi để null rồi thử lại', async () => {
    await seedDemo({ now: NOW, images: 'skip' });
    const custom = { url: 'https://example.com/my-tiramisu.jpg', publicId: null };
    await MenuItem.updateOne({ slug: 'tiramisu' }, { $set: { image: custom } });
    await patchSettings({ name: 'Quán của tôi' });

    const result = await seedDemo({
      now: NOW,
      resolveImage: async (target) => {
        if (target.name === 'demo-pizza-margherita') throw new Error('mạng lỗi');
        return { url: `https://cdn.example/${target.folder}/${target.name}.jpg`, publicId: null };
      },
    });
    // không có logo/ảnh bìa (đã đổi tên), bỏ tiramisu (có ảnh), pizza lỗi
    expect(result.images).toEqual({
      mode: 'link',
      applied: DEMO_CATEGORIES.length + DEMO_MENU_ITEMS.length - 2,
      failed: 1,
    });
    expect((await MenuItem.findOne({ slug: 'tiramisu' }).lean())!.image).toEqual(custom);
    expect((await MenuItem.findOne({ slug: 'pizza-margherita' }).lean())!.image).toBeNull();
    expect((await getSettings()).logo).toBeNull();
    expect((await Category.findOne({ slug: 'khai-vi' }).lean())!.image?.url).toBe(
      'https://cdn.example/categories/demo-khai-vi.jpg',
    );

    const retry = await seedDemo({ now: NOW, images: 'link' });
    expect(retry.images).toEqual({ mode: 'link', applied: 1, failed: 0 });
  });

  it("images: 'skip' không gắn ảnh", async () => {
    const result = await seedDemo({ now: NOW, images: 'skip' });
    expect(result.images).toEqual({ mode: 'skipped', applied: 0, failed: 0 });
    expect(await MenuItem.countDocuments({ image: { $ne: null } })).toBe(0);
    expect((await getSettings()).logo).toBeNull();
  });
});
