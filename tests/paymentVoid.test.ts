import mongoose from 'mongoose';
import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Category } from '../src/modules/menu/category.model';
import { MenuItem } from '../src/modules/menu/menuItem.model';
import { Order } from '../src/modules/orders/order.model';
import { toBusinessDate } from '../src/modules/orders/order.service';
import {
  LEGACY_SESSION_INDEX,
  migratePaymentIndexes,
  Payment,
  SESSION_COMPLETED_INDEX,
} from '../src/modules/payments/payment.model';
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

describe('Huỷ (void) thanh toán ghi nhầm', () => {
  let app: ReturnType<typeof createApp>;
  let auth: string;
  let table: { id: string; qrToken: string };
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

  async function openSession() {
    const res = await api()
      .post('/api/v1/public/sessions')
      .send({ qrToken: table.qrToken, guestCount: 2 });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return { token: res.body.data.sessionToken as string, id: res.body.data.session.id as string };
  }

  /** Mở phiên, gọi 10 trà đá (50.000 → tổng 50.000 vì không VAT/phí), phục vụ xong, thu tiền mặt. */
  async function paidSession(method = 'cash') {
    const { token, id } = await openSession();
    const order = await api()
      .post('/api/v1/public/orders')
      .set('X-Session-Token', token)
      .send({ items: [{ menuItemId: traId, quantity: 10 }] });
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    await Order.updateMany({}, { $set: { status: 'served', 'items.$[].itemStatus': 'served' } });
    const paid = await admin.post(`/sessions/${id}/payments`, {
      method,
      amountReceived: 50000,
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    return { token, sessionId: id, paymentId: paid.body.data.payment.id as string };
  }

  beforeEach(async () => {
    app = createApp();
    await replaceSettings(
      restaurantSettingsSchema.parse({
        name: 'Quán Test',
        openingHours: ALL_DAY,
        vatPercent: 0,
        serviceChargePercent: 0,
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
    const t = await Table.create({ code: 'B01', name: 'Bàn 01' });
    table = { id: t._id.toString(), qrToken: t.qrToken };
    const category = await Category.create({ name: 'Món', slug: 'mon' });
    traId = (
      await MenuItem.create({
        name: 'Trà đá',
        slug: 'tra-da',
        categoryId: category._id,
        price: 5000,
      })
    )._id.toString();
  });

  it('void (không mở lại) → dashboard và /admin/payments không còn tính', async () => {
    const { paymentId, sessionId } = await paidSession();
    const today = toBusinessDate(new Date());

    const before = await admin.get(`/dashboard/summary?date=${today}`);
    expect(before.body.data.revenue.today).toBe(50000);

    const res = await admin.post(`/payments/${paymentId}/void`, {
      reason: 'Ghi nhầm',
      reopenSession: false,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.session).toBeNull();
    expect(res.body.data.table).toBeNull();
    expect(res.body.data.payment).toMatchObject({
      id: paymentId,
      status: 'voided',
      voidReason: 'Ghi nhầm',
      voidedBy: { fullName: 'Nhân viên Test' },
    });
    expect(res.body.data.payment.voidedAt).toBeTruthy();
    // Phiên vẫn đóng, bàn vẫn trống
    expect((await TableSession.findById(sessionId))!.status).toBe('closed');
    expect((await Table.findById(table.id))!.status).toBe('available');

    const summary = await admin.get(`/dashboard/summary?date=${today}`);
    expect(summary.body.data.revenue.today).toBe(0);
    const revenue = await admin.get(`/dashboard/revenue?from=${today}&to=${today}&groupBy=day`);
    expect(revenue.status, JSON.stringify(revenue.body)).toBe(200);
    expect(revenue.body.data.totals.revenue).toBe(0);
    const methods = await admin.get(`/dashboard/payment-methods?from=${today}&to=${today}`);
    expect(methods.body.data.totalAmount).toBe(0);
    expect(methods.body.data.totalCount).toBe(0);

    const list = await admin.get('/payments');
    expect(list.body.data).toHaveLength(0);
    expect(list.body.meta.summary).toMatchObject({ count: 0, total: 0 });
    const voided = await admin.get('/payments?status=voided');
    expect(voided.body.data).toHaveLength(1);
    expect(voided.body.meta.summary).toMatchObject({ count: 1, total: 50000 });
    const all = await admin.get('/payments?status=all');
    expect(all.body.data).toHaveLength(1);
    expect((await admin.get('/payments?status=bad')).status).toBe(400);

    // Chi tiết vẫn xem được
    const detail = await admin.get(`/payments/${paymentId}`);
    expect(detail.body.data.status).toBe('voided');
  });

  it('void + mở lại phiên → thu lại được (bản ghi completed mới)', async () => {
    const { token, sessionId, paymentId } = await paidSession('cash');

    const res = await admin.post(`/payments/${paymentId}/void`, {
      reason: 'Khách chuyển khoản, không phải tiền mặt',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.session).toEqual({ id: sessionId, status: 'payment_requested' });
    expect(res.body.data.table).toMatchObject({ id: table.id, status: 'needs_payment' });

    const session = (await TableSession.findById(sessionId).lean())!;
    expect(session).toMatchObject({
      status: 'payment_requested',
      isActive: true,
      closedAt: null,
      closeReason: null,
      closedBy: null,
    });
    // Token cũ của khách dùng lại được (xem hoá đơn)
    const bill = await api()
      .get('/api/v1/public/sessions/current/bill')
      .set('X-Session-Token', token);
    expect(bill.status, JSON.stringify(bill.body)).toBe(200);

    const repaid = await admin.post(`/sessions/${sessionId}/payments`, {
      method: 'bank_transfer',
    });
    expect(repaid.status, JSON.stringify(repaid.body)).toBe(201);
    expect(repaid.body.data.payment).toMatchObject({ status: 'completed', total: 50000 });
    expect(await Payment.countDocuments({ sessionId })).toBe(2);

    const list = await admin.get('/payments');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta.summary.byMethod).toMatchObject({
      cash: { count: 0, total: 0 },
      bank_transfer: { count: 1, total: 50000 },
    });
    const today = toBusinessDate(new Date());
    expect((await admin.get(`/dashboard/summary?date=${today}`)).body.data.revenue.today).toBe(
      50000,
    );

    // Chi tiết phiên hiển thị thanh toán còn hiệu lực
    const detail = await admin.get(`/sessions/${sessionId}`);
    expect(detail.body.data.payment).toMatchObject({
      id: repaid.body.data.payment.id,
      status: 'completed',
    });

    // Vẫn chỉ được một bản ghi completed / phiên
    await expect(
      Payment.collection.insertOne({
        ...(await Payment.findById(repaid.body.data.payment.id).lean())!,
        _id: new mongoose.Types.ObjectId(),
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('bàn đã có phiên mới → 409 TABLE_HAS_ACTIVE_SESSION, thanh toán không bị huỷ', async () => {
    const { paymentId, sessionId } = await paidSession();
    const next = await openSession();

    const res = await admin.post(`/payments/${paymentId}/void`, { reason: 'Nhầm' });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe('TABLE_HAS_ACTIVE_SESSION');
    expect((await Payment.findById(paymentId))!.status).toBe('completed');
    expect((await TableSession.findById(sessionId))!.status).toBe('closed');
    expect((await TableSession.findById(next.id))!.isActive).toBe(true);
    expect((await Table.findById(table.id))!.status).toBe('occupied');

    // Chỉ huỷ thanh toán, không mở lại phiên → được
    const only = await admin.post(`/payments/${paymentId}/void`, {
      reason: 'Nhầm',
      reopenSession: false,
    });
    expect(only.status).toBe(200);
    expect((await Table.findById(table.id))!.status).toBe('occupied');
  });

  it('void 2 lần → 409 PAYMENT_ALREADY_VOIDED; đồng thời chỉ một request thắng', async () => {
    const { paymentId } = await paidSession();
    const [a, b] = await Promise.all([
      admin.post(`/payments/${paymentId}/void`, { reason: 'Nhầm', reopenSession: false }),
      admin.post(`/payments/${paymentId}/void`, { reason: 'Nhầm', reopenSession: false }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('PAYMENT_ALREADY_VOIDED');

    const again = await admin.post(`/payments/${paymentId}/void`, { reason: 'Nhầm' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PAYMENT_ALREADY_VOIDED');
  });

  it('validate body và 404', async () => {
    const { paymentId } = await paidSession();
    expect((await admin.post(`/payments/${paymentId}/void`, {})).status).toBe(400);
    expect((await admin.post(`/payments/${paymentId}/void`, { reason: '   ' })).status).toBe(400);
    expect(
      (await admin.post(`/payments/${paymentId}/void`, { reason: 'x'.repeat(301) })).status,
    ).toBe(400);
    expect(
      (await admin.post(`/payments/${paymentId}/void`, { reason: 'a', reopenSession: 'yes' }))
        .status,
    ).toBe(400);
    const missing = await admin.post(`/payments/${new mongoose.Types.ObjectId()}/void`, {
      reason: 'a',
    });
    expect(missing.status).toBe(404);
  });
});

describe('migratePaymentIndexes', () => {
  it('gán status cho bản ghi cũ, drop index unique cũ sessionId_1, idempotent', async () => {
    await Payment.init();
    const coll = Payment.collection;
    // Giả lập DB cũ: index unique toàn phần sessionId_1, bản ghi không có status.
    await coll.dropIndex(SESSION_COMPLETED_INDEX);
    await coll.createIndex({ sessionId: 1 }, { unique: true, name: LEGACY_SESSION_INDEX });
    const sessionId = new mongoose.Types.ObjectId();
    const base = {
      sessionId,
      tableId: new mongoose.Types.ObjectId(),
      tableCode: 'B01',
      total: 1000,
      method: 'cash',
      paidAt: new Date(),
      businessDate: '2026-11-19',
      cashierId: new mongoose.Types.ObjectId(),
    };
    await coll.insertOne({ ...base });

    const result = await migratePaymentIndexes();
    expect(result.backfilled).toBe(1);
    expect(result.dropped).toContain(LEGACY_SESSION_INDEX);
    const names = (await coll.indexes()).map((index) => index.name);
    expect(names).toContain(SESSION_COMPLETED_INDEX);
    expect(names).not.toContain(LEGACY_SESSION_INDEX);
    expect((await coll.findOne({ sessionId }))!.status).toBe('completed');

    // Bản ghi completed thứ 2 cho cùng phiên vẫn bị chặn; bản voided thì không.
    await expect(coll.insertOne({ ...base, status: 'completed' })).rejects.toMatchObject({
      code: 11000,
    });
    await coll.insertOne({ ...base, status: 'voided' });

    const again = await migratePaymentIndexes();
    expect(again).toEqual({ backfilled: 0, dropped: [] });
  });
});
