import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { errorHandler } from '../src/middlewares';
import { createRateLimiter } from '../src/middlewares/rateLimit';
import { Category } from '../src/modules/menu/category.model';
import { MenuItem } from '../src/modules/menu/menuItem.model';
import { Order } from '../src/modules/orders/order.model';
import { calculateTotals } from '../src/modules/orders/pricing';
import { toBusinessDate } from '../src/modules/orders/order.service';
import { TableSession } from '../src/modules/sessions/tableSession.model';
import { restaurantSettingsSchema } from '../src/modules/settings/settings.schema';
import { replaceSettings } from '../src/modules/settings/settings.service';
import { Table } from '../src/modules/tables/table.model';
import { setupTestDb } from './helpers/db';

setupTestDb();

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  slots: [{ open: '00:00', close: '24:00' }],
}));
const CLOSED_ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, slots: [] }));

async function setSettings(overrides: Record<string, unknown> = {}) {
  const { ordering, ...rest } = overrides as { ordering?: Record<string, unknown> };
  await replaceSettings(
    restaurantSettingsSchema.parse({
      name: 'Quán Test',
      openingHours: ALL_DAY,
      vatPercent: 8,
      serviceChargePercent: 5,
      ordering: { requireStaffConfirm: true, maxItemQuantityPerOrder: 10, ...ordering },
      ...rest,
    }),
  );
}

describe('calculateTotals', () => {
  it('phí phục vụ trên subtotal, VAT trên (subtotal + phí), làm tròn VND', () => {
    expect(
      calculateTotals(200000, { currency: 'VND', vatPercent: 8, serviceChargePercent: 5 }),
    ).toEqual({
      currency: 'VND',
      subtotal: 200000,
      serviceChargePercent: 5,
      serviceCharge: 10000,
      vatPercent: 8,
      vatAmount: 16800,
      total: 226800,
    });
    const odd = calculateTotals(33333, {
      currency: 'VND',
      vatPercent: 10,
      serviceChargePercent: 5.5,
    });
    expect(odd.serviceCharge).toBe(1833);
    expect(odd.vatAmount).toBe(3517);
    expect(odd.total).toBe(33333 + 1833 + 3517);
    expect(
      calculateTotals(0, { currency: 'VND', vatPercent: 8, serviceChargePercent: 5 }).total,
    ).toBe(0);
  });

  it('tiền tệ có số lẻ làm tròn 2 chữ số', () => {
    const r = calculateTotals(10.5, { currency: 'USD', vatPercent: 10, serviceChargePercent: 0 });
    expect(r.vatAmount).toBe(1.05);
    expect(r.total).toBe(11.55);
  });
});

describe('createRateLimiter', () => {
  it('vượt giới hạn → 429 TOO_MANY_REQUESTS kèm header', async () => {
    const app = express();
    app.use(createRateLimiter({ windowMs: 60_000, limit: 2 }));
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    const api = supertest(app);
    expect((await api.get('/')).status).toBe(200);
    expect((await api.get('/')).status).toBe(200);
    const res = await api.get('/');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(res.headers['retry-after']).toBeDefined();
  });
});

describe('Phiên bàn & đặt món của khách', () => {
  let app: ReturnType<typeof createApp>;
  let table: { _id: { toString(): string }; qrToken: string };
  let pho: { id: string; sizeGroupId: string; sizeS: string; sizeL: string; toppingIds: string[] };
  let tra: string;
  let soldOut: string;
  let hidden: string;

  const api = () => supertest(app);
  const openSession = async (body: Record<string, unknown> = {}) =>
    api()
      .post('/api/v1/public/sessions')
      .send({ qrToken: table.qrToken, ...body });
  const openToken = async () => {
    const res = await openSession({ guestCount: 2 });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return res.body.data.sessionToken as string;
  };
  const asGuest = (token: string) => ({
    get: (url: string) => api().get(`/api/v1/public${url}`).set('X-Session-Token', token),
    post: (url: string, body?: object) =>
      api()
        .post(`/api/v1/public${url}`)
        .set('X-Session-Token', token)
        .send(body ?? {}),
    patch: (url: string, body: object) =>
      api().patch(`/api/v1/public${url}`).set('X-Session-Token', token).send(body),
  });
  const phoLine = (quantity = 1, extra: Record<string, unknown> = {}) => ({
    menuItemId: pho.id,
    quantity,
    optionIds: [pho.sizeL],
    ...extra,
  });

  beforeEach(async () => {
    app = createApp();
    await setSettings();
    const t = await Table.create({ code: 'B08', name: 'Bàn 8' });
    table = { _id: t._id, qrToken: t.qrToken };

    const category = await Category.create({ name: 'Món chính', slug: 'mon-chinh' });
    const hiddenCategory = await Category.create({
      name: 'Ẩn',
      slug: 'an',
      isActive: false,
    });
    const phoDoc = await MenuItem.create({
      name: 'Phở bò',
      slug: 'pho-bo',
      categoryId: category._id,
      price: 60000,
      optionGroups: [
        {
          name: 'Size',
          required: true,
          maxSelect: 1,
          options: [
            { name: 'Nhỏ', priceDelta: 0 },
            { name: 'Lớn', priceDelta: 10000 },
          ],
        },
        {
          name: 'Topping',
          required: false,
          maxSelect: 2,
          options: [
            { name: 'Trứng', priceDelta: 5000 },
            { name: 'Quẩy', priceDelta: 3000 },
            { name: 'Bò viên', priceDelta: 15000 },
          ],
        },
      ],
    });
    const size = phoDoc.optionGroups[0]!;
    pho = {
      id: phoDoc._id.toString(),
      sizeGroupId: size._id.toString(),
      sizeS: size.options[0]!._id.toString(),
      sizeL: size.options[1]!._id.toString(),
      toppingIds: phoDoc.optionGroups[1]!.options.map((o) => o._id.toString()),
    };
    tra = (
      await MenuItem.create({
        name: 'Trà đá',
        slug: 'tra-da',
        categoryId: category._id,
        price: 5000,
      })
    )._id.toString();
    soldOut = (
      await MenuItem.create({
        name: 'Bún chả',
        slug: 'bun-cha',
        categoryId: category._id,
        price: 50000,
        isAvailable: false,
      })
    )._id.toString();
    hidden = (
      await MenuItem.create({
        name: 'Món ẩn',
        slug: 'mon-an',
        categoryId: hiddenCategory._id,
        price: 1000,
      })
    )._id.toString();
  });

  describe('POST /public/sessions', () => {
    it('mở phiên mới → 201, bàn chuyển occupied; quét lại → dùng chung phiên', async () => {
      const first = await openSession({ guestCount: 2, customerName: 'Anh Nam' });
      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({
        isNew: true,
        session: { status: 'open', guestCount: 2, customerName: 'Anh Nam', closedAt: null },
        table: { id: table._id.toString(), code: 'B08', name: 'Bàn 8', area: null },
      });
      expect(first.body.data.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect((await Table.findById(table._id).lean())!.status).toBe('occupied');

      const second = await openSession({ guestCount: 4, customerName: 'Chị Lan' });
      expect(second.status).toBe(200);
      expect(second.body.data.isNew).toBe(false);
      expect(second.body.data.sessionToken).toBe(first.body.data.sessionToken);
      expect(second.body.data.session).toMatchObject({ guestCount: 4, customerName: 'Anh Nam' });

      // guestCount chỉ tăng
      const third = await openSession({ guestCount: 1 });
      expect(third.body.data.session.guestCount).toBe(4);
      expect(await TableSession.countDocuments()).toBe(1);
    });

    it('nhiều khách quét cùng lúc → chỉ một phiên', async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => openSession()));
      const tokens = new Set(results.map((r) => r.body.data.sessionToken));
      expect(tokens.size).toBe(1);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await TableSession.countDocuments()).toBe(1);
    });

    it('phiên đã đóng → quét lại mở phiên mới', async () => {
      const token = await openToken();
      await TableSession.updateOne(
        { sessionToken: token },
        { $set: { status: 'closed', isActive: false, closedAt: new Date() } },
      );
      const res = await openSession();
      expect(res.status).toBe(201);
      expect(res.body.data.sessionToken).not.toBe(token);
    });

    it('phiên payment_requested vẫn được dùng chung, nhưng không gọi thêm món', async () => {
      const token = await openToken();
      await TableSession.updateOne(
        { sessionToken: token },
        { $set: { status: 'payment_requested' } },
      );
      const res = await openSession();
      expect(res.status).toBe(200);
      expect(res.body.data.sessionToken).toBe(token);
      expect(res.body.data.session.status).toBe('payment_requested');

      const order = await asGuest(token).post('/orders', { items: [phoLine()] });
      expect(order.status).toBe(409);
      expect(order.body.error.code).toBe('SESSION_NOT_OPEN');
    });

    it('QR sai / bàn đã tắt → 404 TABLE_NOT_FOUND; thiếu qrToken → 400', async () => {
      const wrong = await api()
        .post('/api/v1/public/sessions')
        .send({ qrToken: 'khong-ton-tai-0123456789' });
      expect(wrong.status).toBe(404);
      expect(wrong.body.error.code).toBe('TABLE_NOT_FOUND');

      await Table.updateOne({ _id: table._id }, { $set: { isActive: false } });
      expect((await openSession()).status).toBe(404);

      expect((await api().post('/api/v1/public/sessions').send({})).status).toBe(400);
      expect((await openSession({ guestCount: 0 })).status).toBe(400);
    });
  });

  describe('xác thực X-Session-Token', () => {
    it.each([
      ['get', '/sessions/current'],
      ['patch', '/sessions/current'],
      ['get', '/sessions/current/orders'],
      ['post', '/orders/quote'],
      ['post', '/orders'],
      ['post', '/orders/665f1c2e8b3a4d0012345678/cancel'],
    ] as const)('%s %s: thiếu / sai token → 401', async (method, url) => {
      const missing = await api()[method](`/api/v1/public${url}`).send({});
      expect(missing.status).toBe(401);
      expect(missing.body.error.code).toBe('INVALID_SESSION');

      const wrong = await api()
        [method](`/api/v1/public${url}`)
        .set('X-Session-Token', 'sai-token-sai-token-sai-token-1234567890ab')
        .send({});
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe('INVALID_SESSION');
    });

    it('phiên đã đóng → 401 SESSION_CLOSED', async () => {
      const token = await openToken();
      await TableSession.updateOne(
        { sessionToken: token },
        { $set: { status: 'closed', isActive: false, closedAt: new Date() } },
      );
      const res = await asGuest(token).get('/sessions/current');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_CLOSED');
    });
  });

  describe('luồng đầy đủ: tạo phiên → quote → đặt món → xem trạng thái', () => {
    it('đặt món với giá lấy từ DB, theo dõi đơn, tổng tạm tính cả phiên', async () => {
      const token = await openToken();
      const guest = asGuest(token);

      // Quote
      const quote = await guest.post('/orders/quote', {
        items: [
          phoLine(2, { optionIds: [pho.sizeL, pho.toppingIds[0]], price: 1, note: ' Không hành ' }),
          { menuItemId: tra, quantity: 3 },
        ],
      });
      expect(quote.status, JSON.stringify(quote.body)).toBe(200);
      // Phở lớn + trứng = 75000 × 2 = 150000; trà 5000 × 3 = 15000
      expect(quote.body.data).toMatchObject({
        subtotal: 165000,
        serviceCharge: 8250,
        vatAmount: 13860,
        total: 187110,
        currency: 'VND',
        canOrderNow: true,
        maxItemQuantityPerOrder: 10,
      });
      expect(quote.body.data.items[0]).toMatchObject({
        nameSnapshot: 'Phở bò',
        priceSnapshot: 60000,
        unitPrice: 75000,
        lineTotal: 150000,
        note: 'Không hành',
        selectedOptions: [
          { groupName: 'Size', optionName: 'Lớn', priceDelta: 10000 },
          { groupName: 'Topping', optionName: 'Trứng', priceDelta: 5000 },
        ],
      });
      expect(await Order.countDocuments()).toBe(0);

      // Đặt món
      const created = await guest.post('/orders', {
        items: [
          phoLine(2, { optionIds: [pho.sizeL, pho.toppingIds[0]], unitPrice: 1 }),
          { menuItemId: tra, quantity: 3 },
        ],
        note: 'Mang ra nhanh',
        subtotal: 1,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const order = created.body.data;
      expect(order).toMatchObject({
        orderNumber: 'ORD-0001',
        businessDate: toBusinessDate(new Date()),
        status: 'pending',
        canCancel: true,
        subtotal: 165000,
        note: 'Mang ra nhanh',
        tableId: table._id.toString(),
        totals: { total: 187110 },
      });
      expect(order.items.every((i: { itemStatus: string }) => i.itemStatus === 'pending')).toBe(
        true,
      );
      expect(order.statusHistory).toEqual([
        { status: 'pending', at: expect.any(String), by: 'guest', note: null },
      ]);

      // Gọi thêm món (đơn thứ 2 trong cùng phiên)
      const second = await guest.post('/orders', { items: [{ menuItemId: tra, quantity: 1 }] });
      expect(second.status).toBe(201);
      expect(second.body.data.orderNumber).toBe('ORD-0002');

      // Giá thay đổi sau khi đặt không ảnh hưởng đơn cũ (snapshot)
      await MenuItem.updateOne({ _id: tra }, { $set: { price: 99999, name: 'Trà đá mới' } });

      const current = await guest.get('/sessions/current');
      expect(current.status).toBe(200);
      expect(current.body.data).toMatchObject({
        session: { status: 'open', guestCount: 2 },
        table: { code: 'B08' },
        bill: {
          orderCount: 2,
          activeOrderCount: 2,
          itemCount: 6,
          subtotal: 170000,
          serviceCharge: 8500,
          vatAmount: 14280,
          total: 192780,
        },
      });

      const list = await guest.get('/sessions/current/orders');
      expect(list.status).toBe(200);
      expect(list.body.data.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([
        'ORD-0002',
        'ORD-0001',
      ]);
      expect(list.body.data[0].items[0]).toMatchObject({
        nameSnapshot: 'Trà đá',
        priceSnapshot: 5000,
      });
      expect(list.body.meta.count).toBe(2);
      const serverTime = list.body.meta.serverTime as string;
      expect(typeof serverTime).toBe('string');

      // Polling: chưa có gì thay đổi → rỗng
      await new Promise((r) => setTimeout(r, 5));
      const none = await guest.get(
        `/sessions/current/orders?updatedSince=${encodeURIComponent(serverTime)}`,
      );
      expect(none.status).toBe(200);
      expect(none.body.data).toEqual([]);

      // Nhân viên xác nhận đơn 1 (mô phỏng) → polling chỉ trả đơn 1
      await Order.updateOne(
        { _id: order.id },
        {
          $set: { status: 'confirmed' },
          $push: { statusHistory: { status: 'confirmed', at: new Date(), by: { type: 'staff' } } },
        },
      );
      const changed = await guest.get(
        `/sessions/current/orders?updatedSince=${encodeURIComponent(serverTime)}`,
      );
      expect(changed.body.data).toHaveLength(1);
      expect(changed.body.data[0]).toMatchObject({
        id: order.id,
        status: 'confirmed',
        canCancel: false,
      });
      expect(changed.body.data[0].statusHistory.map((h: { status: string }) => h.status)).toEqual([
        'pending',
        'confirmed',
      ]);

      expect((await guest.get('/sessions/current/orders?updatedSince=hom-qua')).status).toBe(400);
    });

    it('khách khác cùng bàn thấy chung đơn; phiên bàn khác không thấy', async () => {
      const token = await openToken();
      await asGuest(token).post('/orders', { items: [{ menuItemId: tra, quantity: 1 }] });
      const sameTable = (await openSession()).body.data.sessionToken;
      expect((await asGuest(sameTable).get('/sessions/current/orders')).body.data).toHaveLength(1);

      const other = await Table.create({ code: 'B09', name: 'Bàn 9' });
      const otherToken = (
        await api().post('/api/v1/public/sessions').send({ qrToken: other.qrToken })
      ).body.data.sessionToken;
      expect((await asGuest(otherToken).get('/sessions/current/orders')).body.data).toEqual([]);
    });

    it('requireStaffConfirm=false → đơn tạo ở trạng thái confirmed', async () => {
      await setSettings({ ordering: { requireStaffConfirm: false } });
      const token = await openToken();
      const res = await asGuest(token).post('/orders', {
        items: [{ menuItemId: tra, quantity: 1 }],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('confirmed');
      expect(res.body.data.canCancel).toBe(false);
      expect(res.body.data.items[0].itemStatus).toBe('confirmed');
      expect(
        res.body.data.statusHistory.map((h: { by: string; status: string }) => [h.status, h.by]),
      ).toEqual([
        ['pending', 'guest'],
        ['confirmed', 'system'],
      ]);
    });
  });

  describe('validate giỏ hàng (422 ORDER_ITEMS_INVALID)', () => {
    const expectIssues = async (token: string, items: object[], url = '/orders') => {
      const res = await asGuest(token).post(url, { items });
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(res.body.error.code).toBe('ORDER_ITEMS_INVALID');
      return (res.body.error.details as { index: number; code: string }[]).map((d) => [
        d.index,
        d.code,
      ]);
    };

    it('món hết hàng bị từ chối (cả quote và đặt món), không tạo đơn', async () => {
      const token = await openToken();
      for (const url of ['/orders', '/orders/quote']) {
        expect(
          await expectIssues(
            token,
            [
              { menuItemId: tra, quantity: 1 },
              { menuItemId: soldOut, quantity: 1 },
            ],
            url,
          ),
        ).toEqual([[1, 'ITEM_UNAVAILABLE']]);
      }
      expect(await Order.countDocuments()).toBe(0);
    });

    it('món không tồn tại / bị ẩn / thuộc danh mục ẩn → ITEM_NOT_FOUND', async () => {
      const token = await openToken();
      await MenuItem.updateOne({ _id: tra }, { $set: { isActive: false } });
      expect(
        await expectIssues(token, [
          { menuItemId: '665f1c2e8b3a4d0012345678', quantity: 1 },
          { menuItemId: tra, quantity: 1 },
          { menuItemId: hidden, quantity: 1 },
        ]),
      ).toEqual([
        [0, 'ITEM_NOT_FOUND'],
        [1, 'ITEM_NOT_FOUND'],
        [2, 'ITEM_NOT_FOUND'],
      ]);
    });

    it('lựa chọn không hợp lệ → INVALID_OPTIONS', async () => {
      const token = await openToken();
      expect(
        await expectIssues(token, [
          { menuItemId: pho.id, quantity: 1 }, // thiếu nhóm bắt buộc
          { menuItemId: pho.id, quantity: 1, optionIds: [pho.sizeS, pho.sizeL] }, // vượt maxSelect
          { menuItemId: pho.id, quantity: 1, optionIds: [pho.sizeS, ...pho.toppingIds] }, // topping > 2
          { menuItemId: pho.id, quantity: 1, optionIds: [pho.sizeS, '665f1c2e8b3a4d0012345678'] }, // lạ
          { menuItemId: tra, quantity: 1, optionIds: [pho.sizeS] }, // lựa chọn của món khác
        ]),
      ).toEqual([
        [0, 'INVALID_OPTIONS'],
        [1, 'INVALID_OPTIONS'],
        [2, 'INVALID_OPTIONS'],
        [3, 'INVALID_OPTIONS'],
        [4, 'INVALID_OPTIONS'],
      ]);
    });

    it('số lượng vượt giới hạn (cộng dồn cùng món) → QUANTITY_EXCEEDED', async () => {
      const token = await openToken();
      expect(
        await expectIssues(token, [
          { menuItemId: tra, quantity: 6 },
          phoLine(1),
          { menuItemId: tra, quantity: 5, note: 'ít đá' },
        ]),
      ).toEqual([[0, 'QUANTITY_EXCEEDED']]);
      const ok = await asGuest(token).post('/orders', {
        items: [{ menuItemId: tra, quantity: 10 }],
      });
      expect(ok.status).toBe(201);
    });

    it('body sai định dạng → 400', async () => {
      const guest = asGuest(await openToken());
      expect((await guest.post('/orders', { items: [] })).status).toBe(400);
      expect(
        (await guest.post('/orders', { items: [{ menuItemId: tra, quantity: 0 }] })).status,
      ).toBe(400);
      expect(
        (await guest.post('/orders', { items: [{ menuItemId: tra, quantity: 1.5 }] })).status,
      ).toBe(400);
      expect(
        (await guest.post('/orders', { items: [{ menuItemId: 'abc', quantity: 1 }] })).status,
      ).toBe(400);
      expect(
        (
          await guest.post('/orders', {
            items: [{ menuItemId: pho.id, quantity: 1, optionIds: [pho.sizeS, pho.sizeS] }],
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('nhà hàng không nhận đơn', () => {
    it('tắt đặt món → 409 ORDERING_DISABLED; quote vẫn chạy với canOrderNow=false', async () => {
      await setSettings({ ordering: { enabled: false } });
      const guest = asGuest(await openToken());
      const res = await guest.post('/orders', { items: [{ menuItemId: tra, quantity: 1 }] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDERING_DISABLED');
      const quote = await guest.post('/orders/quote', {
        items: [{ menuItemId: tra, quantity: 1 }],
      });
      expect(quote.status).toBe(200);
      expect(quote.body.data.canOrderNow).toBe(false);
    });

    it('ngoài giờ mở cửa → 409 RESTAURANT_CLOSED; cho phép ngoài giờ → đặt được', async () => {
      await setSettings({ openingHours: CLOSED_ALL_WEEK });
      const guest = asGuest(await openToken());
      const res = await guest.post('/orders', { items: [{ menuItemId: tra, quantity: 1 }] });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESTAURANT_CLOSED');

      await setSettings({
        openingHours: CLOSED_ALL_WEEK,
        ordering: { allowOrderOutsideOpeningHours: true },
      });
      expect(
        (await guest.post('/orders', { items: [{ menuItemId: tra, quantity: 1 }] })).status,
      ).toBe(201);
    });
  });

  describe('POST /public/orders/:id/cancel', () => {
    it('huỷ đơn pending; đơn đã xác nhận / đã huỷ → 409; đơn phiên khác → 404', async () => {
      const token = await openToken();
      const guest = asGuest(token);
      const a = (await guest.post('/orders', { items: [phoLine(1)] })).body.data;
      const b = (await guest.post('/orders', { items: [{ menuItemId: tra, quantity: 2 }] })).body
        .data;

      const cancelled = await guest.post(`/orders/${a.id}/cancel`, { reason: 'Đặt nhầm' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.data).toMatchObject({ status: 'cancelled', canCancel: false });
      expect(cancelled.body.data.items[0].itemStatus).toBe('cancelled');
      expect(cancelled.body.data.statusHistory.at(-1)).toMatchObject({
        status: 'cancelled',
        by: 'guest',
        note: 'Đặt nhầm',
      });

      const again = await guest.post(`/orders/${a.id}/cancel`);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ORDER_NOT_CANCELLABLE');

      await Order.updateOne({ _id: b.id }, { $set: { status: 'preparing' } });
      expect((await guest.post(`/orders/${b.id}/cancel`)).status).toBe(409);

      // Đơn huỷ không tính vào tổng phiên
      const bill = (await guest.get('/sessions/current')).body.data.bill;
      expect(bill).toMatchObject({
        orderCount: 2,
        activeOrderCount: 1,
        itemCount: 2,
        subtotal: 10000,
      });

      const other = await Table.create({ code: 'B10', name: 'Bàn 10' });
      const otherToken = (
        await api().post('/api/v1/public/sessions').send({ qrToken: other.qrToken })
      ).body.data.sessionToken;
      const c = (await guest.post('/orders', { items: [{ menuItemId: tra, quantity: 1 }] })).body
        .data;
      const foreign = await asGuest(otherToken).post(`/orders/${c.id}/cancel`);
      expect(foreign.status).toBe(404);
      expect((await guest.post('/orders/abc/cancel')).status).toBe(400);
    });
  });

  describe('PATCH /public/sessions/current', () => {
    it('cập nhật số khách / tên / ghi chú', async () => {
      const guest = asGuest(await openToken());
      const res = await guest.patch('/sessions/current', { guestCount: 5, customerName: ' Minh ' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({ guestCount: 5, customerName: 'Minh', note: null });
      const cleared = await guest.patch('/sessions/current', { customerName: '' });
      expect(cleared.body.data).toMatchObject({ guestCount: 5, customerName: null });
      expect((await guest.patch('/sessions/current', {})).status).toBe(400);
    });
  });
});
