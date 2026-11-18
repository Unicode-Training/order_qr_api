import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Category } from '../src/modules/menu/category.model';
import { MenuItem } from '../src/modules/menu/menuItem.model';
import { Order } from '../src/modules/orders/order.model';
import { toBusinessDate } from '../src/modules/orders/order.service';
import { calculateBillTotals } from '../src/modules/orders/pricing';
import { Payment } from '../src/modules/payments/payment.model';
import { ServiceRequest } from '../src/modules/serviceRequests/serviceRequest.model';
import { TableSession } from '../src/modules/sessions/tableSession.model';
import { restaurantSettingsSchema } from '../src/modules/settings/settings.schema';
import { replaceSettings } from '../src/modules/settings/settings.service';
import { Table } from '../src/modules/tables/table.model';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  slots: [{ open: '00:00', close: '24:00' }],
}));

const VND = { currency: 'VND', vatPercent: 8, serviceChargePercent: 5 };

describe('calculateBillTotals', () => {
  it('giảm giá trừ sau VAT/phí, làm tròn VND, không âm', () => {
    expect(calculateBillTotals(155000, VND)).toMatchObject({
      subtotal: 155000,
      serviceCharge: 7750,
      vatAmount: 13020,
      totalBeforeDiscount: 175770,
      discountAmount: 0,
      total: 175770,
    });
    const discounted = calculateBillTotals(155000, VND, 5770.4);
    expect(discounted.discountAmount).toBe(5770);
    expect(discounted.total).toBe(170000);
    // VAT/phí không đổi khi có giảm giá
    expect(discounted.vatAmount).toBe(13020);
    expect(calculateBillTotals(1000, VND, 999999).total).toBe(0);
    const odd = calculateBillTotals(33333, { ...VND, serviceChargePercent: 5.5, vatPercent: 10 });
    expect(Number.isInteger(odd.total)).toBe(true);
    expect(odd.total).toBe(33333 + 1833 + 3517);
  });
});

describe('Yêu cầu thanh toán, thanh toán và đóng phiên', () => {
  let app: ReturnType<typeof createApp>;
  let auth: string;
  let table: { id: string; qrToken: string };
  let table2: { id: string; qrToken: string };
  let phoId: string;
  let sizeL: string;
  let traId: string;

  const api = () => supertest(app);
  const admin = {
    get: (url: string) => api().get(`/api/v1/admin${url}`).set('Authorization', auth),
    post: (url: string, body?: object) =>
      api()
        .post(`/api/v1/admin${url}`)
        .set('Authorization', auth)
        .send(body ?? {}),
  };
  const guest = (token: string) => ({
    get: (url: string) => api().get(`/api/v1/public${url}`).set('X-Session-Token', token),
    post: (url: string, body?: object) =>
      api()
        .post(`/api/v1/public${url}`)
        .set('X-Session-Token', token)
        .send(body ?? {}),
  });

  async function openSession(qrToken = table.qrToken) {
    const res = await api().post('/api/v1/public/sessions').send({ qrToken, guestCount: 2 });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return { token: res.body.data.sessionToken as string, id: res.body.data.session.id as string };
  }

  /** 2 Phở Lớn (70k) + 3 trà đá (5k) = 155.000 */
  async function placeOrder(token: string, lines?: object[]) {
    const res = await guest(token).post('/orders', {
      items: lines ?? [
        { menuItemId: phoId, quantity: 2, optionIds: [sizeL] },
        { menuItemId: traId, quantity: 3 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; items: { id: string }[] };
  }

  const serveAll = () =>
    Order.updateMany(
      { status: { $ne: 'cancelled' } },
      { $set: { status: 'served', 'items.$[].itemStatus': 'served' } },
    );

  beforeEach(async () => {
    app = createApp();
    await replaceSettings(
      restaurantSettingsSchema.parse({
        name: 'Quán Test',
        openingHours: ALL_DAY,
        vatPercent: 8,
        serviceChargePercent: 5,
        ordering: { requireStaffConfirm: true },
        paymentMethods: ['cash', 'bank_transfer'],
        bankTransferInfo: {
          bankName: 'Vietcombank',
          accountNumber: '0123456789',
          accountName: 'NGUYEN VAN A',
        },
      }),
    );
    await createUser();
    auth = `Bearer ${(await loginAs(app)).accessToken}`;

    const t1 = await Table.create({ code: 'B01', name: 'Bàn 01' });
    const t2 = await Table.create({ code: 'B02', name: 'Bàn 02' });
    table = { id: t1._id.toString(), qrToken: t1.qrToken };
    table2 = { id: t2._id.toString(), qrToken: t2.qrToken };

    const category = await Category.create({ name: 'Món', slug: 'mon' });
    const pho = await MenuItem.create({
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
      ],
    });
    phoId = pho._id.toString();
    sizeL = pho.optionGroups[0]!.options[1]!._id.toString();
    traId = (
      await MenuItem.create({
        name: 'Trà đá',
        slug: 'tra-da',
        categoryId: category._id,
        price: 5000,
      })
    )._id.toString();
  });

  describe('Khách: request-bill & bill', () => {
    it('yêu cầu thanh toán → phiên payment_requested, bàn needs_payment, tạo 1 ServiceRequest', async () => {
      const { token, id } = await openSession();
      await placeOrder(token);

      const res = await guest(token).post('/sessions/current/request-bill', {
        preferredMethod: 'bank_transfer',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.bill).toMatchObject({
        sessionStatus: 'payment_requested',
        preferredPaymentMethod: 'bank_transfer',
        subtotal: 155000,
        serviceCharge: 7750,
        vatAmount: 13020,
        total: 175770,
      });
      expect(res.body.data.serviceRequest).toMatchObject({
        type: 'request_bill',
        status: 'pending',
      });

      expect((await TableSession.findById(id))!.status).toBe('payment_requested');
      expect((await Table.findById(table.id))!.status).toBe('needs_payment');

      // Gọi lại → không tạo yêu cầu trùng, chỉ cập nhật phương thức
      const again = await guest(token).post('/sessions/current/request-bill', {
        preferredMethod: 'cash',
      });
      expect(again.status).toBe(200);
      const requests = await ServiceRequest.find({ sessionId: id });
      expect(requests).toHaveLength(1);
      expect(requests[0]!.preferredMethod).toBe('cash');

      // Không gọi thêm món được
      const order = await guest(token).post('/orders', {
        items: [{ menuItemId: traId, quantity: 1 }],
      });
      expect(order.status).toBe(409);
      expect(order.body.error.code).toBe('SESSION_NOT_OPEN');
    });

    it('dùng lại request_bill khách gửi qua /service-requests; thu tiền → yêu cầu done', async () => {
      const { token, id } = await openSession();
      await placeOrder(token);
      const quick = await guest(token).post('/service-requests', { type: 'request_bill' });
      expect(quick.status, JSON.stringify(quick.body)).toBe(201);
      const call = await guest(token).post('/service-requests', { type: 'call_staff' });
      expect(call.status).toBe(201);

      const res = await guest(token).post('/sessions/current/request-bill', {
        preferredMethod: 'cash',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.serviceRequest.id).toBe(quick.body.data.id);
      expect(await ServiceRequest.countDocuments({ sessionId: id, type: 'request_bill' })).toBe(1);

      await serveAll();
      const paid = await admin.post(`/sessions/${id}/payments`, {
        method: 'cash',
        amountReceived: 200000,
      });
      expect(paid.status).toBe(201);
      const requests = await ServiceRequest.find({ sessionId: id });
      expect(requests).toHaveLength(2);
      for (const r of requests) {
        expect(r.status).toBe('done');
        expect(r.doneAt).toBeInstanceOf(Date);
      }
    });

    it('phương thức chưa bật → 422; phiên chưa có món → 409 NOTHING_TO_PAY', async () => {
      const { token } = await openSession();
      const empty = await guest(token).post('/sessions/current/request-bill');
      expect(empty.status).toBe(409);
      expect(empty.body.error.code).toBe('NOTHING_TO_PAY');

      await placeOrder(token);
      const card = await guest(token).post('/sessions/current/request-bill', {
        preferredMethod: 'card',
      });
      expect(card.status).toBe(422);
      expect(card.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    });

    it('hoá đơn gộp các đơn không huỷ, bỏ món đã huỷ, kèm thông tin chuyển khoản', async () => {
      const { token } = await openSession();
      const first = await placeOrder(token);
      const cancelled = await placeOrder(token, [{ menuItemId: traId, quantity: 10 }]);
      expect((await guest(token).post(`/orders/${cancelled.id}/cancel`)).status).toBe(200);
      await placeOrder(token, [{ menuItemId: traId, quantity: 2 }]);
      // Món trà trong đơn đầu bị nhân viên huỷ riêng
      await Order.updateOne(
        { _id: first.id, 'items._id': first.items[1]!.id },
        { $set: { 'items.$.itemStatus': 'cancelled' } },
      );

      const res = await guest(token).get('/sessions/current/bill');
      expect(res.status).toBe(200);
      const bill = res.body.data;
      expect(bill.orders).toHaveLength(2);
      expect(bill.items).toHaveLength(2);
      expect(bill.items[0]).toMatchObject({ name: 'Phở bò', options: ['Lớn'], quantity: 2 });
      expect(bill.subtotal).toBe(140000 + 10000);
      expect(bill.total).toBe(calculateBillTotals(150000, VND).total);
      expect(bill.bankTransfer).toMatchObject({
        bankName: 'Vietcombank',
        accountNumber: '0123456789',
        amount: bill.total,
      });
      expect(bill.bankTransfer.transferContent).toMatch(/^B01 [0-9A-F]{6}$/);
    });
  });

  describe('Nhân viên: thanh toán & đóng phiên', () => {
    it('còn đơn chưa xử lý → 409 UNFINISHED_ORDERS; force → thu được kèm cảnh báo', async () => {
      const { token, id } = await openSession();
      await placeOrder(token);

      const blocked = await admin.post(`/sessions/${id}/payments`, {
        method: 'cash',
        amountReceived: 200000,
      });
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe('UNFINISHED_ORDERS');
      expect(blocked.body.error.details.unfinishedOrders).toHaveLength(1);
      expect((await TableSession.findById(id))!.status).toBe('open');

      const forced = await admin.post(`/sessions/${id}/payments`, {
        method: 'cash',
        amountReceived: 200000,
        force: true,
      });
      expect(forced.status, JSON.stringify(forced.body)).toBe(201);
      expect(forced.body.data.payment.forced).toBe(true);
      expect(forced.body.data.warnings[0]).toMatch(/ORD-0001 \(pending\)/);
    });

    it('tổng đúng với VAT/phí/giảm giá; đóng phiên, giải phóng bàn, token cũ bị từ chối', async () => {
      const { token, id } = await openSession();
      const order = await placeOrder(token);
      await guest(token).post('/sessions/current/request-bill', { preferredMethod: 'cash' });
      await serveAll();

      const bill = await admin.get(`/tables/${table.id}/bill`);
      expect(bill.status).toBe(200);
      expect(bill.body.data).toMatchObject({ sessionId: id, total: 175770 });
      expect((await admin.get(`/sessions/${id}/bill`)).body.data.total).toBe(175770);

      const res = await admin.post(`/sessions/${id}/payments`, {
        method: 'cash',
        amountReceived: 200000,
        discountAmount: 5770,
        discountReason: 'Khách quen',
        note: 'Bàn 1 thanh toán',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const { payment } = res.body.data;
      expect(payment).toMatchObject({
        sessionId: id,
        table: { id: table.id, code: 'B01' },
        orderIds: [order.id],
        subtotal: 155000,
        serviceCharge: 7750,
        vat: 13020,
        discount: 5770,
        discountReason: 'Khách quen',
        total: 170000,
        method: 'cash',
        amountReceived: 200000,
        change: 30000,
        forced: false,
        businessDate: toBusinessDate(new Date()),
        cashier: { fullName: 'Nhân viên Test' },
      });
      expect(res.body.data.session).toMatchObject({ status: 'closed', closeReason: 'paid' });
      expect(res.body.data.table).toMatchObject({ id: table.id, status: 'available' });

      const session = await TableSession.findById(id);
      expect(session).toMatchObject({ status: 'closed', isActive: false });
      expect((await Table.findById(table.id))!.status).toBe('available');
      const requests = await ServiceRequest.find({ sessionId: id });
      expect(requests.map((r) => r.status)).toEqual(['done']);

      // Token cũ bị từ chối
      const current = await guest(token).get('/sessions/current');
      expect(current.status).toBe(401);
      expect(current.body.error.code).toBe('SESSION_CLOSED');
      const reorder = await guest(token).post('/orders', {
        items: [{ menuItemId: traId, quantity: 1 }],
      });
      expect(reorder.status).toBe(401);
      expect(reorder.body.error.code).toBe('SESSION_CLOSED');

      // Quét lại QR → phiên mới, token mới
      const reopened = await api().post('/api/v1/public/sessions').send({ qrToken: table.qrToken });
      expect(reopened.status).toBe(201);
      expect(reopened.body.data.sessionToken).not.toBe(token);
      expect((await Table.findById(table.id))!.status).toBe('occupied');

      // Thu lần 2 → 409
      const twice = await admin.post(`/sessions/${id}/payments`, {
        method: 'cash',
        amountReceived: 200000,
      });
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('SESSION_CLOSED');
      expect(await Payment.countDocuments()).toBe(1);
    });

    it('chuyển khoản không cần amountReceived; tiền thiếu / giảm giá sai bị từ chối', async () => {
      const { token, id } = await openSession();
      await placeOrder(token);
      await serveAll();

      const noAmount = await admin.post(`/sessions/${id}/payments`, { method: 'cash' });
      expect(noAmount.status).toBe(400);

      const noReason = await admin.post(`/sessions/${id}/payments`, {
        method: 'cash',
        amountReceived: 200000,
        discountAmount: 1000,
      });
      expect(noReason.status).toBe(400);

      const short = await admin.post(`/sessions/${id}/payments`, {
        method: 'cash',
        amountReceived: 100000,
      });
      expect(short.status).toBe(422);
      expect(short.body.error.code).toBe('INSUFFICIENT_AMOUNT');
      expect(short.body.error.details).toMatchObject({ total: 175770, missing: 75770 });

      const tooMuchDiscount = await admin.post(`/sessions/${id}/payments`, {
        method: 'cash',
        amountReceived: 0,
        discountAmount: 999999,
        discountReason: 'x',
      });
      expect(tooMuchDiscount.status).toBe(422);
      expect(tooMuchDiscount.body.error.code).toBe('INVALID_DISCOUNT');
      expect((await TableSession.findById(id))!.status).toBe('open');

      const transfer = await admin.post(`/sessions/${id}/payments`, { method: 'bank_transfer' });
      expect(transfer.status).toBe(201);
      expect(transfer.body.data.payment).toMatchObject({
        total: 175770,
        amountReceived: 175770,
        change: 0,
      });
    });

    it('phiên trống: không thu được, huỷ phiên giải phóng bàn; phiên có món không huỷ được', async () => {
      const { id } = await openSession();
      const pay = await admin.post(`/sessions/${id}/payments`, { method: 'bank_transfer' });
      expect(pay.status).toBe(409);
      expect(pay.body.error.code).toBe('NOTHING_TO_PAY');

      const cancel = await admin.post(`/sessions/${id}/cancel`, { reason: 'Quét nhầm' });
      expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
      expect(cancel.body.data.session).toMatchObject({
        status: 'closed',
        closeReason: 'cancelled',
      });
      expect((await Table.findById(table.id))!.status).toBe('available');

      const other = await openSession(table2.qrToken);
      await placeOrder(other.token);
      const notEmpty = await admin.post(`/sessions/${other.id}/cancel`);
      expect(notEmpty.status).toBe(409);
      expect(notEmpty.body.error.code).toBe('SESSION_NOT_EMPTY');
    });

    it('bàn trống → GET /tables/:id/bill 404 NO_ACTIVE_SESSION', async () => {
      const res = await admin.get(`/tables/${table.id}/bill`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NO_ACTIVE_SESSION');
    });
  });

  describe('Chuyển bàn', () => {
    it('chuyển sang bàn trống: đơn đi theo, token vẫn dùng được, bàn cũ trống', async () => {
      const { token, id } = await openSession();
      const order = await placeOrder(token);
      await guest(token).post('/sessions/current/request-bill');

      const res = await admin.post(`/sessions/${id}/move`, { toTableId: table2.id });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data).toMatchObject({
        session: { id, tableId: table2.id },
        fromTable: { id: table.id, status: 'available' },
        toTable: { id: table2.id, code: 'B02', status: 'needs_payment' },
      });
      expect((await Order.findById(order.id))!.tableId.toString()).toBe(table2.id);
      expect((await ServiceRequest.findOne({ sessionId: id }))!.tableId.toString()).toBe(table2.id);
      const current = await guest(token).get('/sessions/current');
      expect(current.status).toBe(200);
      expect(current.body.data.table.code).toBe('B02');
      // Bàn cũ quét QR → phiên mới
      expect(
        (await api().post('/api/v1/public/sessions').send({ qrToken: table.qrToken })).status,
      ).toBe(201);
    });

    it('bàn đích có khách / trùng bàn → lỗi', async () => {
      const a = await openSession();
      await openSession(table2.qrToken);
      const busy = await admin.post(`/sessions/${a.id}/move`, { toTableId: table2.id });
      expect(busy.status).toBe(409);
      expect(busy.body.error.code).toBe('TABLE_NOT_AVAILABLE');
      const same = await admin.post(`/sessions/${a.id}/move`, { toTableId: table.id });
      expect(same.status).toBe(400);
      expect(same.body.error.code).toBe('SAME_TABLE');
      expect((await TableSession.findById(a.id))!.tableId.toString()).toBe(table.id);
    });
  });

  describe('GET /admin/payments', () => {
    it('lọc theo ngày, phương thức và tổng hợp', async () => {
      const s1 = await openSession();
      await placeOrder(s1.token);
      const s2 = await openSession(table2.qrToken);
      await placeOrder(s2.token, [{ menuItemId: traId, quantity: 2 }]);
      await serveAll();
      expect(
        (
          await admin.post(`/sessions/${s1.id}/payments`, {
            method: 'cash',
            amountReceived: 200000,
          })
        ).status,
      ).toBe(201);
      expect(
        (await admin.post(`/sessions/${s2.id}/payments`, { method: 'bank_transfer' })).status,
      ).toBe(201);
      // Thanh toán ngày cũ
      await Payment.updateOne({ sessionId: s2.id }, { $set: { businessDate: '2026-01-01' } });

      const all = await admin.get('/payments');
      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(2);
      expect(all.body.meta).toMatchObject({ total: 2, page: 1 });
      expect(all.body.meta.summary.byMethod.cash).toEqual({ count: 1, total: 175770 });

      const today = toBusinessDate(new Date());
      const filtered = await admin.get(`/payments?from=${today}&to=${today}`);
      expect(filtered.body.data).toHaveLength(1);
      expect(filtered.body.data[0].method).toBe('cash');

      const byMethod = await admin.get('/payments?method=bank_transfer');
      expect(byMethod.body.data).toHaveLength(1);
      expect(byMethod.body.meta.summary).toMatchObject({ count: 1, total: 11340 });

      const one = await admin.get(`/payments/${all.body.data[0].id}`);
      expect(one.status).toBe(200);

      const bad = await admin.get('/payments?from=2026-02-01&to=2026-01-01');
      expect(bad.status).toBe(400);
    });

    it('cần đăng nhập', async () => {
      expect((await api().get('/api/v1/admin/payments')).status).toBe(401);
    });
  });
});
