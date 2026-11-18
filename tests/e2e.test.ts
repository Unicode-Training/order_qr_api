/**
 * Test end-to-end toàn bộ luồng qua HTTP (không chạm DB trực tiếp trừ khi khởi tạo tài khoản đầu tiên):
 * admin tạo món & bàn → khách resolve QR → mở phiên → đặt món → nhân viên xác nhận → bếp chuẩn bị →
 * phục vụ → khách yêu cầu thanh toán → nhân viên ghi nhận thanh toán → bàn trống → dashboard có doanh thu.
 */
import supertest from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { toBusinessDate } from '../src/modules/orders/order.service';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  slots: [{ open: '00:00', close: '24:00' }],
}));

describe('E2E: từ tạo thực đơn tới dashboard', () => {
  it('chạy trọn luồng đặt món → thanh toán → dashboard', async () => {
    const app = createApp();
    const api = supertest(app);
    await createUser({ email: 'quanly@example.com', fullName: 'Quản lý' });
    const { accessToken } = await loginAs(app, 'quanly@example.com');
    const bearer = `Bearer ${accessToken}`;
    const admin = {
      get: (url: string) => api.get(`/api/v1/admin${url}`).set('Authorization', bearer),
      post: (url: string, body: object = {}) =>
        api.post(`/api/v1/admin${url}`).set('Authorization', bearer).send(body),
      put: (url: string, body: object) =>
        api.put(`/api/v1/admin${url}`).set('Authorization', bearer).send(body),
      patch: (url: string, body: object) =>
        api.patch(`/api/v1/admin${url}`).set('Authorization', bearer).send(body),
    };
    const expectStatus = (res: supertest.Response, status: number) =>
      expect(res.status, JSON.stringify(res.body)).toBe(status);

    // ---------- 0. Admin cấu hình nhà hàng: VAT 8%, phí phục vụ 5%, cần nhân viên xác nhận đơn
    expectStatus(
      await admin.put('/settings', {
        name: 'Le Bistro & Grill',
        openingHours: ALL_DAY,
        vatPercent: 8,
        serviceChargePercent: 5,
        ordering: { requireStaffConfirm: true },
        paymentMethods: ['cash', 'bank_transfer'],
        bankTransferInfo: {
          bankName: 'Vietcombank',
          accountNumber: '0071001234567',
          accountName: 'LE BISTRO',
        },
      }),
      200,
    );

    // ---------- 1. Admin tạo khu vực, bàn, danh mục, món
    const area = await admin.post('/areas', { name: 'Tầng 1' });
    expectStatus(area, 201);
    const table = await admin.post('/tables', { code: 'a01', areaId: area.body.data.id });
    expectStatus(table, 201);
    expect(table.body.data).toMatchObject({ code: 'A01', status: 'available' });
    const tableId: string = table.body.data.id;
    const qrToken: string = table.body.data.qrToken;

    const category = await admin.post('/categories', { name: 'Bít tết' });
    expectStatus(category, 201);
    const steak = await admin.post('/menu-items', {
      name: 'Bít tết thăn bò',
      categoryId: category.body.data.id,
      price: 389000,
      optionGroups: [
        {
          name: 'Mức chín',
          required: true,
          maxSelect: 1,
          options: [
            { name: 'Tái', priceDelta: 0 },
            { name: 'Chín kỹ', priceDelta: 0 },
          ],
        },
      ],
    });
    expectStatus(steak, 201);
    const wine = await admin.post('/menu-items', {
      name: 'Rượu vang đỏ (ly)',
      categoryId: category.body.data.id,
      price: 129000,
    });
    expectStatus(wine, 201);
    const steakId: string = steak.body.data.id;
    const rareId: string = steak.body.data.optionGroups[0].options[0].id;

    // ---------- 2. Khách quét QR → thông tin bàn + nhà hàng, xem thực đơn
    const resolved = await api.get(`/api/v1/public/tables/resolve/${qrToken}`);
    expectStatus(resolved, 200);
    expect(resolved.body.data.table).toMatchObject({ id: tableId, code: 'A01' });
    expect(resolved.body.data.restaurant.name).toBe('Le Bistro & Grill');
    const menu = await api.get('/api/v1/public/menu');
    expectStatus(menu, 200);
    expect(JSON.stringify(menu.body.data)).toContain('Bít tết thăn bò');

    // ---------- 3. Mở phiên bàn → bàn occupied
    const opened = await api.post('/api/v1/public/sessions').send({ qrToken, guestCount: 2 });
    expectStatus(opened, 201);
    const token: string = opened.body.data.sessionToken;
    const sessionId: string = opened.body.data.session.id;
    const guest = {
      get: (url: string) => api.get(`/api/v1/public${url}`).set('X-Session-Token', token),
      post: (url: string, body: object = {}) =>
        api.post(`/api/v1/public${url}`).set('X-Session-Token', token).send(body),
    };
    expect((await admin.get(`/tables/${tableId}`)).body.data.status).toBe('occupied');
    // Khách thứ 2 quét cùng QR → dùng chung phiên
    const joined = await api.post('/api/v1/public/sessions').send({ qrToken });
    expectStatus(joined, 200);
    expect(joined.body.data.sessionToken).toBe(token);

    // ---------- 4. Báo giá & đặt món: 2 bít tết (778.000) + 2 vang (258.000) = 1.036.000
    const items = [
      { menuItemId: steakId, quantity: 2, optionIds: [rareId], note: 'Ít muối' },
      { menuItemId: wine.body.data.id, quantity: 2 },
    ];
    const quote = await guest.post('/orders/quote', { items });
    expectStatus(quote, 200);
    const order = await guest.post('/orders', { items, note: 'Mang vang ra trước' });
    expectStatus(order, 201);
    const orderId: string = order.body.data.id;
    expect(order.body.data).toMatchObject({ status: 'pending', subtotal: 1036000 });
    expect(order.body.data.orderNumber).toMatch(/^ORD-\d{4}$/);

    // Polling phía khách: lấy serverTime, lần sau chỉ nhận đơn thay đổi
    const firstPoll = await guest.get('/sessions/current/orders');
    expectStatus(firstPoll, 200);
    const since: string = firstPoll.body.meta.serverTime;

    // ---------- 5. Nhân viên thấy đơn pending → xác nhận → bếp chuẩn bị → sẵn sàng → phục vụ
    const pending = await admin.get('/orders?status=pending');
    expectStatus(pending, 200);
    expect(pending.body.data.map((o: { id: string }) => o.id)).toContain(orderId);

    for (const status of ['confirmed', 'preparing', 'ready', 'served']) {
      const res = await admin.patch(`/orders/${orderId}/status`, { status });
      expectStatus(res, 200);
      expect(res.body.data.status).toBe(status);
    }
    // Không thể quay lui trạng thái
    expectStatus(await admin.patch(`/orders/${orderId}/status`, { status: 'preparing' }), 409);

    const changed = await guest.get(
      `/sessions/current/orders?updatedSince=${encodeURIComponent(since)}`,
    );
    expectStatus(changed, 200);
    expect(changed.body.data).toHaveLength(1);
    expect(changed.body.data[0]).toMatchObject({ id: orderId, status: 'served' });

    // ---------- 6. Khách yêu cầu thanh toán → bàn needs_payment, có yêu cầu request_bill
    const billRequest = await guest.post('/sessions/current/request-bill', {
      preferredMethod: 'cash',
    });
    expectStatus(billRequest, 200);
    // Phí 5% = 51.800; VAT 8% × (1.036.000 + 51.800) = 87.024 → 1.174.824
    expect(billRequest.body.data.bill).toMatchObject({
      subtotal: 1036000,
      serviceCharge: 51800,
      vatAmount: 87024,
      total: 1174824,
    });
    expect((await admin.get(`/tables/${tableId}`)).body.data.status).toBe('needs_payment');
    const requests = await admin.get('/service-requests');
    expectStatus(requests, 200);
    expect(JSON.stringify(requests.body.data)).toContain('request_bill');

    // ---------- 7. Nhân viên xem hoá đơn và ghi nhận tiền mặt → phiên đóng, bàn trống
    const bill = await admin.get(`/tables/${tableId}/bill`);
    expectStatus(bill, 200);
    expect(bill.body.data.total).toBe(1174824);
    const paid = await admin.post(`/sessions/${sessionId}/payments`, {
      method: 'cash',
      amountReceived: 1200000,
    });
    expectStatus(paid, 201);
    expect(paid.body.data.payment).toMatchObject({ total: 1174824, change: 25176, method: 'cash' });
    expect(paid.body.data.session.status).toBe('closed');
    expect(paid.body.data.table.status).toBe('available');
    expect((await admin.get(`/tables/${tableId}`)).body.data.status).toBe('available');

    // Token phiên cũ hết hiệu lực; quét lại QR mở phiên mới
    const closed = await guest.get('/sessions/current');
    expectStatus(closed, 401);
    expect(closed.body.error.code).toBe('SESSION_CLOSED');

    // ---------- 8. Dashboard phản ánh doanh thu, đơn, món bán chạy, phương thức thanh toán
    const today = toBusinessDate(new Date());
    const summary = await admin.get(`/dashboard/summary?date=${today}`);
    expectStatus(summary, 200);
    expect(summary.body.data).toMatchObject({
      revenue: { today: 1174824 },
      orders: { count: 1, cancelled: 0 },
      invoices: { count: 1, averageValue: 1174824 },
      tables: { serving: 0, total: 1 },
      pending: { orders: 0 },
    });
    expect(summary.body.data.serviceTime.servedOrders).toBe(1);

    const top = await admin.get(`/dashboard/top-items?from=${today}&to=${today}`);
    expectStatus(top, 200);
    expect(JSON.stringify(top.body.data)).toContain('Bít tết thăn bò');

    const methods = await admin.get(`/dashboard/payment-methods?from=${today}&to=${today}`);
    expectStatus(methods, 200);
    expect(JSON.stringify(methods.body.data)).toContain('1174824');

    const revenue = await admin.get(`/dashboard/revenue?from=${today}&to=${today}&groupBy=day`);
    expectStatus(revenue, 200);
    expect(JSON.stringify(revenue.body.data)).toContain('1174824');

    const payments = await admin.get('/payments');
    expectStatus(payments, 200);
    expect(payments.body.data).toHaveLength(1);
  });
});
