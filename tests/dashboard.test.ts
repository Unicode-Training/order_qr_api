import { Types } from 'mongoose';
import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { percentChange } from '../src/modules/dashboard/dashboard.service';
import { Category } from '../src/modules/menu/category.model';
import { MenuItem } from '../src/modules/menu/menuItem.model';
import { Order, type OrderStatus } from '../src/modules/orders/order.model';
import { toBusinessDate } from '../src/modules/orders/order.service';
import { Payment } from '../src/modules/payments/payment.model';
import { ServiceRequest } from '../src/modules/serviceRequests/serviceRequest.model';
import { TableSession } from '../src/modules/sessions/tableSession.model';
import type { PaymentMethod } from '../src/modules/settings/settings.schema';
import { Table } from '../src/modules/tables/table.model';
import { addDays, diffDays, isValidDateString, zonedTimeToUtc } from '../src/utils/zonedDate';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

/** Thời điểm theo giờ Việt Nam (UTC+7). */
const vn = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);

const D = '2026-03-10';
const D1 = '2026-03-09'; // hôm qua
const D2 = '2026-03-08';

describe('zonedDate', () => {
  it('chuyển ngày giờ địa phương sang UTC theo Asia/Ho_Chi_Minh', () => {
    expect(zonedTimeToUtc(D).toISOString()).toBe('2026-03-09T17:00:00.000Z');
    expect(zonedTimeToUtc(D, 23).toISOString()).toBe('2026-03-10T16:00:00.000Z');
    expect(zonedTimeToUtc('2026-03-08', 0, 'America/New_York').toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(zonedTimeToUtc('2026-03-08', 4, 'America/New_York').toISOString()).toBe(
      '2026-03-08T08:00:00.000Z',
    );
  });

  it('cộng/trừ ngày, khoảng cách ngày và kiểm tra ngày hợp lệ', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(diffDays('2026-02-27', '2026-03-10')).toBe(11);
    expect(isValidDateString('2026-02-29')).toBe(false);
    expect(isValidDateString('2028-02-29')).toBe(true);
    expect(isValidDateString('2026-13-01')).toBe(false);
  });

  it('percentChange', () => {
    expect(percentChange(400000, 200000)).toBe(100);
    expect(percentChange(133333, 200000)).toBe(-33.3);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 0)).toBe(0);
  });
});

describe('Admin dashboard', () => {
  let app: ReturnType<typeof createApp>;
  let auth: string;
  let tableId: Types.ObjectId;
  let cashierId: Types.ObjectId;
  let orderSeq = 0;

  const get = (url: string) =>
    supertest(app).get(`/api/v1/admin/dashboard${url}`).set('Authorization', auth);

  async function createSession(guestCount: number | null) {
    return TableSession.create({
      tableId: new Types.ObjectId(), // không dính unique index (mỗi bàn 1 phiên mở)
      guestCount,
      status: 'closed',
      closedAt: new Date(),
    });
  }

  async function createPayment(
    paidAt: Date,
    total: number,
    method: PaymentMethod,
    guestCount: number | null = 2,
  ) {
    const session = await createSession(guestCount);
    return Payment.create({
      sessionId: session._id,
      tableId,
      tableCode: 'B01',
      currency: 'VND',
      subtotal: total,
      serviceChargePercent: 0,
      serviceCharge: 0,
      vatPercent: 0,
      vat: 0,
      total,
      method,
      amountReceived: total,
      change: 0,
      paidAt,
      businessDate: toBusinessDate(paidAt),
      cashierId,
    });
  }

  interface SeedItem {
    menuItemId: Types.ObjectId;
    name: string;
    price: number;
    quantity: number;
    cancelled?: boolean;
  }

  async function createOrder(
    createdAt: Date,
    status: OrderStatus,
    items: SeedItem[] = [],
    history: { status: OrderStatus; at: Date }[] = [],
  ) {
    orderSeq += 1;
    const lines = items.map((item) => ({
      menuItemId: item.menuItemId,
      nameSnapshot: item.name,
      priceSnapshot: item.price,
      quantity: item.quantity,
      unitPrice: item.price,
      lineTotal: item.price * item.quantity,
      itemStatus: item.cancelled ? 'cancelled' : status,
    }));
    const order = new Order({
      orderNumber: `ORD-${String(orderSeq).padStart(4, '0')}`,
      businessDate: toBusinessDate(createdAt),
      sessionId: new Types.ObjectId(),
      tableId,
      items:
        lines.length > 0
          ? lines
          : [
              {
                menuItemId: new Types.ObjectId(),
                nameSnapshot: 'Nước',
                priceSnapshot: 10000,
                quantity: 1,
                unitPrice: 10000,
                lineTotal: 10000,
                itemStatus: status,
              },
            ],
      status,
      subtotal: lines.filter((_l, i) => !items[i]!.cancelled).reduce((s, l) => s + l.lineTotal, 0),
      statusHistory: [
        { status: 'pending', at: createdAt, by: { type: 'guest', userId: null } },
        ...history.map((h) => ({ ...h, by: { type: 'staff', userId: cashierId } })),
      ],
      createdAt,
      updatedAt: createdAt,
    });
    await order.save({ timestamps: false });
    return order;
  }

  beforeEach(async () => {
    app = createApp();
    orderSeq = 0;
    const user = await createUser();
    cashierId = user._id;
    auth = `Bearer ${(await loginAs(app)).accessToken}`;
    tableId = (await Table.create({ code: 'B01', name: 'Bàn 01', status: 'occupied' }))._id;
  });

  it('bắt buộc đăng nhập', async () => {
    const res = await supertest(app).get('/api/v1/admin/dashboard/summary');
    expect(res.status).toBe(401);
  });

  describe('summary', () => {
    beforeEach(async () => {
      // Thanh toán hôm nay (D): 50k lúc 00:30 (UTC vẫn là ngày D-1), 100k lúc 08:30, 250k lúc 23:30
      await createPayment(vn(D, '00:30'), 50000, 'cash', null);
      await createPayment(vn(D, '08:30'), 100000, 'cash', 2);
      await createPayment(vn(D, '23:30'), 250000, 'bank_transfer', 4);
      // Hôm qua: 200k; hôm kia: 999k (không được tính)
      await createPayment(vn(D1, '12:00'), 200000, 'card', 3);
      await createPayment(vn(D2, '12:00'), 999000, 'cash', 3);

      // Đơn hôm nay: 2 served (20 & 10 phút), 1 pending, 1 cancelled
      await createOrder(
        vn(D, '11:00'),
        'served',
        [],
        [
          { status: 'confirmed', at: vn(D, '11:02') },
          { status: 'preparing', at: vn(D, '11:05') },
          { status: 'ready', at: vn(D, '11:20') },
          { status: 'served', at: vn(D, '11:22') },
        ],
      );
      await createOrder(
        vn(D, '12:00'),
        'served',
        [],
        [
          { status: 'confirmed', at: vn(D, '12:00') },
          { status: 'served', at: vn(D, '12:10') },
        ],
      );
      await createOrder(vn(D, '13:00'), 'pending');
      await createOrder(
        vn(D, '13:30'),
        'cancelled',
        [],
        [{ status: 'cancelled', at: vn(D, '13:31') }],
      );
      // Đơn served nhưng thiếu mốc confirmed → bỏ qua khi tính thời gian phục vụ
      await createOrder(vn(D, '14:00'), 'served', [], [{ status: 'served', at: vn(D, '15:00') }]);
      // Hôm qua: 2 đơn
      await createOrder(vn(D1, '10:00'), 'served');
      await createOrder(vn(D1, '11:00'), 'confirmed');

      // Bàn: B01 occupied + 1 needs_payment + 2 available; 1 bàn ngừng hoạt động không tính
      await Table.create([
        { code: 'B02', name: 'Bàn 02', status: 'needs_payment' },
        { code: 'B03', name: 'Bàn 03' },
        { code: 'B04', name: 'Bàn 04' },
        { code: 'B05', name: 'Bàn 05', status: 'occupied', isActive: false },
      ]);

      const sr = { sessionId: new Types.ObjectId(), tableId, type: 'call_staff' as const };
      await ServiceRequest.create([
        { ...sr, status: 'pending' },
        { ...sr, status: 'pending', type: 'request_water' },
        { ...sr, status: 'acknowledged' },
        { ...sr, status: 'done' },
      ]);
    });

    it('tính đúng doanh thu, đơn, hoá đơn TB, bàn, thời gian phục vụ, yêu cầu chờ', async () => {
      const res = await get(`/summary?date=${D}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        date: D,
        timezone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
        revenue: { today: 400000, yesterday: 200000, changePercent: 100 },
        orders: { count: 4, yesterday: 2, changePercent: 100, cancelled: 1 },
        invoices: {
          count: 3,
          averageValue: 133333,
          yesterdayAverageValue: 200000,
          averageValueChangePercent: -33.3,
        },
        tables: { serving: 2, needsPayment: 1, total: 4, occupancyPercent: 50 },
        serviceTime: { averageMinutes: 15, servedOrders: 2 },
        pending: { serviceRequests: 2, orders: 1, total: 3 },
      });
    });

    it('ngày không có dữ liệu → 0 và null hợp lý', async () => {
      const res = await get('/summary?date=2026-01-01');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        revenue: { today: 0, yesterday: 0, changePercent: 0 },
        orders: { count: 0, cancelled: 0 },
        invoices: { count: 0, averageValue: 0 },
        serviceTime: { averageMinutes: null, servedOrders: 0 },
      });
      // ngày sau D: hôm qua = D có doanh thu → giảm 100%
      const next = await get(`/summary?date=${addDays(D, 1)}`);
      expect(next.body.data.revenue).toEqual({ today: 0, yesterday: 400000, changePercent: -100 });
    });

    it('mặc định là hôm nay; ngày sai → 400', async () => {
      const res = await get('/summary');
      expect(res.status).toBe(200);
      expect(res.body.data.date).toBe(toBusinessDate(new Date()));
      expect((await get('/summary?date=2026-02-30')).status).toBe(400);
      expect((await get('/summary?date=10-03-2026')).status).toBe(400);
    });
  });

  describe('revenue', () => {
    beforeEach(async () => {
      await createPayment(vn(D, '00:30'), 50000, 'cash', null); // khách = 1
      await createPayment(vn(D, '08:10'), 100000, 'cash', 2);
      await createPayment(vn(D, '08:50'), 30000, 'card', 3);
      await createPayment(vn(D, '23:59'), 250000, 'bank_transfer', 4);
      await createPayment(vn(D1, '12:00'), 200000, 'card', 3);
      await createPayment(vn('2026-02-27', '20:00'), 70000, 'cash', 2);
      await createPayment(vn(addDays(D, 1), '00:00'), 1, 'cash', 1); // ngoài khoảng
    });

    it('theo giờ: 24 mốc, điền 0, nhóm theo giờ Việt Nam', async () => {
      const res = await get(`/revenue?from=${D}&to=${D}&groupBy=hour`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const { points, totals } = res.body.data;
      expect(points).toHaveLength(24);
      expect(points[0]).toEqual({
        key: `${D}T00:00`,
        start: '2026-03-09T17:00:00.000Z',
        revenue: 50000,
        invoices: 1,
        guests: 1,
      });
      expect(points[8]).toMatchObject({
        key: `${D}T08:00`,
        revenue: 130000,
        invoices: 2,
        guests: 5,
      });
      expect(points[23]).toMatchObject({ key: `${D}T23:00`, revenue: 250000, guests: 4 });
      expect(points[12]).toMatchObject({ revenue: 0, invoices: 0, guests: 0 });
      expect(totals).toEqual({ revenue: 430000, invoices: 4, guests: 10 });
    });

    it('một ngày mặc định nhóm theo giờ, nhiều ngày theo ngày', async () => {
      const single = await get(`/revenue?from=${D}`);
      expect(single.body.data).toMatchObject({ from: D, to: D, groupBy: 'hour' });
      const multi = await get(`/revenue?from=${D2}&to=${D}`);
      expect(multi.body.data.groupBy).toBe('day');
      expect(
        multi.body.data.points.map((p: { key: string; revenue: number }) => [p.key, p.revenue]),
      ).toEqual([
        [D2, 0],
        [D1, 200000],
        [D, 430000],
      ]);
    });

    it('theo tháng', async () => {
      const res = await get(`/revenue?from=2026-02-01&to=${D}&groupBy=month`);
      expect(res.status).toBe(200);
      expect(res.body.data.points).toEqual([
        {
          key: '2026-02',
          start: '2026-01-31T17:00:00.000Z',
          revenue: 70000,
          invoices: 1,
          guests: 2,
        },
        {
          key: '2026-03',
          start: '2026-02-28T17:00:00.000Z',
          revenue: 630000,
          invoices: 5,
          guests: 13,
        },
      ]);
    });

    it('validate khoảng ngày', async () => {
      expect((await get(`/revenue?from=${D}&to=${D1}`)).status).toBe(400);
      expect((await get('/revenue?from=2026-01-01&to=2026-03-01&groupBy=hour')).status).toBe(400);
      expect((await get('/revenue?from=2026-01-01&to=2026-03-01&groupBy=day')).status).toBe(200);
      expect((await get(`/revenue?from=${D}&groupBy=week`)).status).toBe(400);
    });
  });

  describe('top-items', () => {
    it('cộng số lượng/doanh thu, bỏ đơn & món huỷ, sắp theo số lượng', async () => {
      const category = await Category.create({ name: 'Món', slug: 'mon' });
      const pho = await MenuItem.create({
        name: 'Phở bò (tên mới)',
        slug: 'pho-bo',
        categoryId: category._id,
        price: 60000,
        image: { url: 'https://res.cloudinary.com/demo/pho.jpg', publicId: 'pho' },
      });
      const tra = { menuItemId: new Types.ObjectId(), name: 'Trà đá', price: 5000 };
      const com = { menuItemId: new Types.ObjectId(), name: 'Cơm gà', price: 50000 };
      const phoLine = { menuItemId: pho._id, name: 'Phở bò', price: 60000 };

      await createOrder(vn(D, '10:00'), 'served', [
        { ...phoLine, quantity: 2 },
        { ...tra, quantity: 3 },
      ]);
      await createOrder(vn(D, '11:00'), 'confirmed', [
        { ...phoLine, quantity: 1 },
        { ...com, quantity: 1, cancelled: true },
      ]);
      await createOrder(vn(D, '12:00'), 'cancelled', [{ ...com, quantity: 10 }]);
      await createOrder(vn(D1, '12:00'), 'served', [{ ...tra, quantity: 4 }]);
      await createOrder(vn(D, '13:00'), 'served', [{ ...com, quantity: 1 }]);

      const res = await get(`/top-items?from=${D}&to=${D}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const tra3 = {
        menuItemId: tra.menuItemId.toString(),
        name: 'Trà đá',
        image: null,
        quantity: 3,
        revenue: 15000,
        orderCount: 1,
      };
      const pho3 = {
        menuItemId: pho._id.toString(),
        name: 'Phở bò (tên mới)', // lấy tên hiện tại của món
        image: { url: 'https://res.cloudinary.com/demo/pho.jpg' },
        quantity: 3,
        revenue: 180000,
        orderCount: 2,
      };
      // Cùng số lượng 3 → phở (doanh thu cao hơn) đứng trước trà
      expect(res.body.data).toMatchObject({ from: D, to: D, currency: 'VND' });
      expect(res.body.data.items).toEqual([
        pho3,
        tra3,
        {
          menuItemId: com.menuItemId.toString(),
          name: 'Cơm gà',
          image: null,
          quantity: 1,
          revenue: 50000,
          orderCount: 1,
        },
      ]);

      const limited = await get(`/top-items?from=${D1}&to=${D}&limit=1`);
      expect(limited.body.data.items).toEqual([
        { ...tra3, quantity: 7, revenue: 35000, orderCount: 2 },
      ]);
      expect((await get('/top-items?limit=0')).status).toBe(400);
      expect((await get('/top-items?limit=51')).status).toBe(400);
    });
  });

  describe('recent-orders', () => {
    it('trả đơn mới nhất trước, có thông tin bàn, theo limit', async () => {
      await createOrder(vn(D, '09:00'), 'served');
      const latest = await createOrder(vn(D, '11:00'), 'pending');
      const second = await createOrder(vn(D, '10:00'), 'cancelled');
      const res = await get('/recent-orders?limit=2');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([
        latest._id.toString(),
        second._id.toString(),
      ]);
      expect(res.body.data[0]).toMatchObject({
        orderNumber: latest.orderNumber,
        status: 'pending',
        table: { code: 'B01', name: 'Bàn 01' },
      });
      expect((await get('/recent-orders')).body.data).toHaveLength(3);
    });
  });

  describe('payment-methods', () => {
    it('tỉ lệ theo số tiền và số hoá đơn, đủ mọi phương thức', async () => {
      await createPayment(vn(D, '00:10'), 300000, 'cash');
      await createPayment(vn(D, '09:00'), 100000, 'cash');
      await createPayment(vn(D, '20:00'), 600000, 'bank_transfer');
      await createPayment(vn(D1, '23:59'), 999000, 'card'); // ngoài khoảng

      const res = await get(`/payment-methods?from=${D}&to=${D}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toEqual({
        from: D,
        to: D,
        currency: 'VND',
        totalAmount: 1000000,
        totalCount: 3,
        items: [
          {
            method: 'bank_transfer',
            count: 1,
            amount: 600000,
            amountPercent: 60,
            countPercent: 33.3,
          },
          { method: 'cash', count: 2, amount: 400000, amountPercent: 40, countPercent: 66.7 },
          { method: 'card', count: 0, amount: 0, amountPercent: 0, countPercent: 0 },
        ],
      });

      const range = await get(`/payment-methods?from=${D1}&to=${D}`);
      expect(range.body.data.totalAmount).toBe(1999000);
      expect(range.body.data.items[0]).toMatchObject({ method: 'card', amountPercent: 50 });

      const empty = await get('/payment-methods?from=2026-01-01');
      expect(empty.body.data.totalAmount).toBe(0);
      expect(empty.body.data.items).toHaveLength(3);
    });
  });
});
