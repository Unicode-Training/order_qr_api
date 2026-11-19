import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Area } from '../src/modules/areas/area.model';
import { Category } from '../src/modules/menu/category.model';
import { MenuItem } from '../src/modules/menu/menuItem.model';
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

describe('Phiên bàn cho nhân viên /admin/sessions', () => {
  let app: ReturnType<typeof createApp>;
  let auth: string;
  let userId: string;
  let t1: { id: string; qrToken: string };
  let t2: { id: string; qrToken: string };
  let areaId: string;
  let traId: string;

  const api = () => supertest(app);
  const admin = {
    get: (url: string) => api().get(`/api/v1/admin${url}`).set('Authorization', auth),
    post: (url: string, body?: object) =>
      api()
        .post(`/api/v1/admin${url}`)
        .set('Authorization', auth)
        .send(body ?? {}),
    patch: (url: string, body?: object) =>
      api()
        .patch(`/api/v1/admin${url}`)
        .set('Authorization', auth)
        .send(body ?? {}),
  };

  async function openSession(qrToken: string, body: object = { guestCount: 2 }) {
    const res = await api()
      .post('/api/v1/public/sessions')
      .send({ qrToken, ...body });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return { token: res.body.data.sessionToken as string, id: res.body.data.session.id as string };
  }

  /** quantity × trà đá 5.000 */
  async function placeOrder(token: string, quantity = 2) {
    const res = await api()
      .post('/api/v1/public/orders')
      .set('X-Session-Token', token)
      .send({ items: [{ menuItemId: traId, quantity }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string };
  }

  async function payCash(sessionId: string) {
    await admin
      .post(`/sessions/${sessionId}/payments`, {
        method: 'cash',
        amountReceived: 1_000_000,
        force: true,
      })
      .expect(201);
  }

  beforeEach(async () => {
    app = createApp();
    await replaceSettings(
      restaurantSettingsSchema.parse({
        name: 'Quán Test',
        openingHours: ALL_DAY,
        vatPercent: 0,
        serviceChargePercent: 0,
        ordering: { requireStaffConfirm: true },
        paymentMethods: ['cash'],
      }),
    );
    await createUser({ fullName: 'Thu Ngân A' });
    const login = await loginAs(app);
    auth = `Bearer ${login.accessToken}`;
    userId = login.userId;

    const area = await Area.create({ name: 'Sân vườn' });
    areaId = area._id.toString();
    const b1 = await Table.create({ code: 'B01', name: 'Bàn 01' });
    const b2 = await Table.create({ code: 'V01', name: 'Vườn 01', areaId: area._id });
    t1 = { id: b1._id.toString(), qrToken: b1.qrToken };
    t2 = { id: b2._id.toString(), qrToken: b2.qrToken };

    const category = await Category.create({ name: 'Đồ uống', slug: 'do-uong' });
    traId = (
      await MenuItem.create({
        name: 'Trà đá',
        slug: 'tra-da',
        categoryId: category._id,
        price: 5000,
      })
    )._id.toString();
  });

  it.each([
    ['get', '/api/v1/admin/sessions'],
    ['get', '/api/v1/admin/sessions/665f1c2e8b3a4d0012345678'],
    ['patch', '/api/v1/admin/sessions/665f1c2e8b3a4d0012345678'],
  ] as const)('%s %s không có token → 401', async (method, url) => {
    await supertest(app)[method](url).expect(401);
  });

  it('mặc định chỉ liệt kê phiên chưa đóng, kèm bàn, orderCount/subtotal (không tính đơn huỷ), không có sessionToken', async () => {
    const s1 = await openSession(t1.qrToken, { guestCount: 3, customerName: 'Anh Minh' });
    await placeOrder(s1.token, 2);
    const cancelled = await placeOrder(s1.token, 4);
    await api()
      .post(`/api/v1/public/orders/${cancelled.id}/cancel`)
      .set('X-Session-Token', s1.token)
      .expect(200);
    await placeOrder(s1.token, 1);

    const s2 = await openSession(t2.qrToken);
    await placeOrder(s2.token, 1);
    await payCash(s2.id);

    const res = await admin.get('/sessions').expect(200);
    expect(res.body.meta).toMatchObject({ page: 1, total: 1, totalPages: 1 });
    expect(res.body.data).toHaveLength(1);
    const item = res.body.data[0];
    expect(item).toMatchObject({
      id: s1.id,
      table: { id: t1.id, code: 'B01', name: 'Bàn 01' },
      status: 'open',
      guestCount: 3,
      customerName: 'Anh Minh',
      closedAt: null,
      closeReason: null,
      closedBy: null,
      orderCount: 2,
      subtotal: 15000,
    });
    expect(JSON.stringify(res.body)).not.toContain(s1.token);
    expect(item).not.toHaveProperty('sessionToken');

    // closed → có closedBy, closeReason
    const closed = await admin.get('/sessions?status=closed').expect(200);
    expect(closed.body.data).toHaveLength(1);
    expect(closed.body.data[0]).toMatchObject({
      id: s2.id,
      status: 'closed',
      closeReason: 'paid',
      closedBy: { id: userId, fullName: 'Thu Ngân A' },
      orderCount: 1,
      subtotal: 5000,
    });
    expect(JSON.stringify(closed.body)).not.toContain(s2.token);

    // nhiều trạng thái
    const all = await admin.get('/sessions?status=open,closed').expect(200);
    expect(all.body.meta.total).toBe(2);

    await admin.get('/sessions?status=bogus').expect(400);
  });

  it('lọc theo bàn, khu vực, closeReason; payment_requested hiện trong mặc định', async () => {
    const s1 = await openSession(t1.qrToken);
    await placeOrder(s1.token);
    await api()
      .post('/api/v1/public/sessions/current/request-bill')
      .set('X-Session-Token', s1.token)
      .send({ preferredMethod: 'cash' })
      .expect(200);
    const s2 = await openSession(t2.qrToken);
    await admin.post(`/sessions/${s2.id}/cancel`, { reason: 'Quét nhầm' }).expect(200);
    const s3 = await openSession(t2.qrToken);

    const open = await admin.get('/sessions').expect(200);
    expect(open.body.data.map((s: { id: string }) => s.id).sort()).toEqual([s1.id, s3.id].sort());
    const requested = open.body.data.find((s: { id: string }) => s.id === s1.id);
    expect(requested).toMatchObject({
      status: 'payment_requested',
      preferredPaymentMethod: 'cash',
    });
    expect(requested.paymentRequestedAt).toBeTruthy();

    const byTable = await admin.get(`/sessions?tableId=${t1.id}`).expect(200);
    expect(byTable.body.data.map((s: { id: string }) => s.id)).toEqual([s1.id]);

    const byArea = await admin.get(`/sessions?areaId=${areaId}&status=open,closed`).expect(200);
    expect(byArea.body.data.map((s: { id: string }) => s.id)).toEqual([s3.id, s2.id]);

    // areaId + tableId không thuộc khu vực → rỗng
    const none = await admin.get(`/sessions?areaId=${areaId}&tableId=${t1.id}`).expect(200);
    expect(none.body).toMatchObject({ data: [], meta: { total: 0 } });

    // closeReason không kèm status → mặc định closed
    const cancelled = await admin.get('/sessions?closeReason=cancelled').expect(200);
    expect(cancelled.body.data.map((s: { id: string }) => s.id)).toEqual([s2.id]);
    expect(cancelled.body.data[0].closeReason).toBe('cancelled');
    const paid = await admin.get('/sessions?closeReason=paid').expect(200);
    expect(paid.body.data).toEqual([]);
  });

  it('lọc theo ngày mở phiên (giờ Asia/Ho_Chi_Minh), phân trang', async () => {
    const s1 = await openSession(t1.qrToken);
    const s2 = await openSession(t2.qrToken);
    // 2026-11-10 23:30 giờ VN = 16:30Z; 2026-11-11 00:30 giờ VN = 2026-11-10T17:30Z
    await TableSession.updateOne({ _id: s1.id }, { openedAt: new Date('2026-11-10T16:30:00Z') });
    await TableSession.updateOne({ _id: s2.id }, { openedAt: new Date('2026-11-10T17:30:00Z') });

    const d10 = await admin.get('/sessions?from=2026-11-10&to=2026-11-10').expect(200);
    expect(d10.body.data.map((s: { id: string }) => s.id)).toEqual([s1.id]);
    const d11 = await admin.get('/sessions?from=2026-11-11').expect(200);
    expect(d11.body.data.map((s: { id: string }) => s.id)).toEqual([s2.id]);
    const untilD10 = await admin.get('/sessions?to=2026-11-10').expect(200);
    expect(untilD10.body.data.map((s: { id: string }) => s.id)).toEqual([s1.id]);

    // mới nhất trước, phân trang
    const page1 = await admin.get('/sessions?limit=1').expect(200);
    expect(page1.body.meta).toMatchObject({ total: 2, totalPages: 2, limit: 1 });
    expect(page1.body.data[0].id).toBe(s2.id);
    const page2 = await admin.get('/sessions?limit=1&page=2&sort=openedAt').expect(200);
    expect(page2.body.data[0].id).toBe(s2.id);

    await admin.get('/sessions?from=2026-11-12&to=2026-11-10').expect(400);
    await admin.get('/sessions?from=2026-02-30').expect(400);
  });

  it('chi tiết phiên mở: đơn (dùng DTO admin), bill tạm tính, payment null', async () => {
    const s1 = await openSession(t1.qrToken);
    const o1 = await placeOrder(s1.token, 2);
    const o2 = await placeOrder(s1.token, 1);
    await api()
      .post(`/api/v1/public/orders/${o2.id}/cancel`)
      .set('X-Session-Token', s1.token)
      .expect(200);

    const res = await admin.get(`/sessions/${s1.id}`).expect(200);
    const data = res.body.data;
    expect(data).toMatchObject({
      id: s1.id,
      status: 'open',
      orderCount: 1,
      subtotal: 10000,
      payment: null,
      bill: { sessionId: s1.id, subtotal: 10000, total: 10000 },
    });
    expect(data.orders.map((o: { id: string }) => o.id)).toEqual([o1.id, o2.id]);
    expect(data.orders[0]).toMatchObject({
      table: { id: t1.id, code: 'B01' },
      allowedNextStatuses: expect.any(Array),
    });
    expect(JSON.stringify(res.body)).not.toContain(s1.token);

    await admin.get('/sessions/665f1c2e8b3a4d0012345678').expect(404);
    await admin.get('/sessions/abc').expect(400);
  });

  it('chi tiết phiên đã thanh toán: payment có, bill null', async () => {
    const s1 = await openSession(t1.qrToken);
    await placeOrder(s1.token, 3);
    await payCash(s1.id);

    const res = await admin.get(`/sessions/${s1.id}`).expect(200);
    expect(res.body.data).toMatchObject({
      status: 'closed',
      closeReason: 'paid',
      bill: null,
      orderCount: 1,
      subtotal: 15000,
      payment: { sessionId: s1.id, total: 15000, method: 'cash', cashier: { id: userId } },
    });
  });

  it('PATCH sửa số khách/tên/ghi chú; validate; phiên đóng → 409', async () => {
    const s1 = await openSession(t1.qrToken, { guestCount: 2, customerName: 'Chị Lan' });

    const res = await admin
      .patch(`/sessions/${s1.id}`, { guestCount: 6, customerName: '', note: 'Có trẻ em' })
      .expect(200);
    expect(res.body.data).toMatchObject({
      id: s1.id,
      guestCount: 6,
      customerName: null,
      note: 'Có trẻ em',
      orderCount: 0,
    });
    expect(res.body.data).not.toHaveProperty('sessionToken');
    expect((await TableSession.findById(s1.id))?.guestCount).toBe(6);

    // khách thấy số mới
    const current = await api()
      .get('/api/v1/public/sessions/current')
      .set('X-Session-Token', s1.token)
      .expect(200);
    expect(current.body.data.session.guestCount).toBe(6);

    await admin.patch(`/sessions/${s1.id}`, {}).expect(400);
    await admin.patch(`/sessions/${s1.id}`, { guestCount: 0 }).expect(400);
    await admin.patch('/sessions/665f1c2e8b3a4d0012345678', { guestCount: 2 }).expect(404);

    await admin.post(`/sessions/${s1.id}/cancel`).expect(200);
    const closed = await admin.patch(`/sessions/${s1.id}`, { guestCount: 3 }).expect(409);
    expect(closed.body.error.code).toBe('SESSION_CLOSED');
  });

  it('phiên do nhân viên mở (tạo đơn thay khách) → sửa được số khách', async () => {
    const created = await admin
      .post(`/tables/${t1.id}/orders`, { items: [{ menuItemId: traId, quantity: 1 }] })
      .expect(201);
    const list = await admin.get('/sessions').expect(200);
    expect(list.body.data).toHaveLength(1);
    const sessionId = list.body.data[0].id as string;
    expect(list.body.data[0]).toMatchObject({ guestCount: null, orderCount: 1 });
    expect(created.body.data).toBeTruthy();

    await admin.patch(`/sessions/${sessionId}`, { guestCount: 4 }).expect(200);
    const detail = await admin.get(`/sessions/${sessionId}`).expect(200);
    expect(detail.body.data.guestCount).toBe(4);
  });
});
