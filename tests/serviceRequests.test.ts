import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Area } from '../src/modules/areas/area.model';
import { ServiceRequest } from '../src/modules/serviceRequests/serviceRequest.model';
import { TableSession } from '../src/modules/sessions/tableSession.model';
import { Table } from '../src/modules/tables/table.model';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

describe('Yêu cầu nhanh tại bàn', () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  let userId: string;
  let areaId: string;
  let tables: { id: string; qrToken: string }[];

  const api = () => supertest(app);
  const admin = {
    get: (url: string) => api().get(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`),
    patch: (url: string, body: object) =>
      api().patch(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`).send(body),
  };
  const guest = (sessionToken: string) => ({
    get: (url = '') =>
      api().get(`/api/v1/public/service-requests${url}`).set('X-Session-Token', sessionToken),
    post: (body: object) =>
      api().post('/api/v1/public/service-requests').set('X-Session-Token', sessionToken).send(body),
  });
  async function openSession(index = 0) {
    const res = await api()
      .post('/api/v1/public/sessions')
      .send({ qrToken: tables[index]!.qrToken });
    expect(res.status).toBeLessThan(300);
    return res.body.data.sessionToken as string;
  }

  beforeEach(async () => {
    app = createApp();
    userId = (await createUser({ fullName: 'Anh Phục Vụ' }))._id.toString();
    ({ accessToken: token } = await loginAs(app));
    const area = await Area.create({ name: 'Sân vườn' });
    areaId = area._id.toString();
    const t1 = await Table.create({ code: 'B01', name: 'Bàn 1', areaId: area._id });
    const t2 = await Table.create({ code: 'B02', name: 'Bàn 2' });
    tables = [t1, t2].map((t) => ({ id: t._id.toString(), qrToken: t.qrToken }));
  });

  describe('Khách', () => {
    it('cần X-Session-Token hợp lệ, phiên chưa đóng', async () => {
      expect(
        (await api().post('/api/v1/public/service-requests').send({ type: 'call_staff' })).status,
      ).toBe(401);
      const sessionToken = await openSession();
      await TableSession.updateOne({ sessionToken }, { status: 'closed' });
      const res = await guest(sessionToken).post({ type: 'call_staff' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('SESSION_CLOSED');
    });

    it('tạo yêu cầu và xem yêu cầu của phiên mình', async () => {
      const mine = await openSession(0);
      const other = await openSession(1);
      const created = await guest(mine).post({ type: 'request_water', note: '  Thêm đá  ' });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        type: 'request_water',
        note: 'Thêm đá',
        status: 'pending',
        acknowledgedAt: null,
        doneAt: null,
      });
      expect(created.body.data.handledBy).toBeUndefined();
      await guest(other).post({ type: 'call_staff' });

      const list = await guest(mine).get();
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toBe(created.body.data.id);
      expect(list.body.meta.serverTime).toBeDefined();
    });

    it('validate loại yêu cầu và ghi chú', async () => {
      const sessionToken = await openSession();
      expect((await guest(sessionToken).post({ type: 'dance' })).status).toBe(400);
      expect((await guest(sessionToken).post({})).status).toBe(400);
      expect(
        (await guest(sessionToken).post({ type: 'other', note: 'x'.repeat(301) })).status,
      ).toBe(400);
    });

    it('chống spam: không tạo trùng loại đang pending', async () => {
      const sessionToken = await openSession();
      const first = await guest(sessionToken).post({ type: 'call_staff' });
      expect(first.status).toBe(201);

      const dup = await guest(sessionToken).post({ type: 'call_staff', note: 'nhanh lên' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('SERVICE_REQUEST_DUPLICATE');
      expect(dup.body.error.details.id).toBe(first.body.data.id);

      // Loại khác vẫn tạo được
      expect((await guest(sessionToken).post({ type: 'request_bill' })).status).toBe(201);
      // Bàn khác cùng loại vẫn tạo được
      const other = await openSession(1);
      expect((await guest(other).post({ type: 'call_staff' })).status).toBe(201);

      // Sau khi nhân viên tiếp nhận thì gửi lại được
      await admin.patch(`/service-requests/${first.body.data.id}`, { status: 'acknowledged' });
      expect((await guest(sessionToken).post({ type: 'call_staff' })).status).toBe(201);
      expect(await ServiceRequest.countDocuments({ type: 'call_staff' })).toBe(3);
    });

    it('bấm đồng thời nhiều lần chỉ tạo một yêu cầu', async () => {
      const sessionToken = await openSession();
      await ServiceRequest.init(); // đảm bảo unique index đã tạo
      const results = await Promise.all(
        Array.from({ length: 5 }, () => guest(sessionToken).post({ type: 'request_utensils' })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await ServiceRequest.countDocuments()).toBe(1);
    });

    it('updatedSince chỉ trả yêu cầu có thay đổi', async () => {
      const sessionToken = await openSession();
      const a = await guest(sessionToken).post({ type: 'call_staff' });
      await guest(sessionToken).post({ type: 'request_water' });
      const since = (await guest(sessionToken).get()).body.meta.serverTime as string;
      await new Promise((resolve) => setTimeout(resolve, 5));
      await admin.patch(`/service-requests/${a.body.data.id}`, { status: 'done' });
      const delta = await guest(sessionToken).get(`?updatedSince=${encodeURIComponent(since)}`);
      expect(delta.body.data.map((r: { id: string }) => r.id)).toEqual([a.body.data.id]);
      expect(delta.body.data[0].status).toBe('done');
    });
  });

  describe('Nhân viên', () => {
    it('yêu cầu đăng nhập', async () => {
      expect((await api().get('/api/v1/admin/service-requests')).status).toBe(401);
    });

    it('lọc theo trạng thái (nhiều giá trị), loại, bàn, khu vực, updatedSince', async () => {
      const s1 = await openSession(0);
      const s2 = await openSession(1);
      const r1 = (await guest(s1).post({ type: 'call_staff' })).body.data;
      const r2 = (await guest(s1).post({ type: 'request_bill' })).body.data;
      const r3 = (await guest(s2).post({ type: 'request_water' })).body.data;
      await admin.patch(`/service-requests/${r2.id}`, { status: 'acknowledged' });
      await admin.patch(`/service-requests/${r3.id}`, { status: 'done' });

      const all = await admin.get('/service-requests');
      expect(all.status).toBe(200);
      expect(all.body.meta).toMatchObject({ total: 3, page: 1 });
      expect(all.body.data[0]).toMatchObject({
        id: r3.id,
        table: { id: tables[1]!.id, code: 'B02', area: null },
        handledBy: { id: userId, fullName: 'Anh Phục Vụ' },
      });

      const pending = await admin.get('/service-requests?status=pending');
      expect(pending.body.data.map((r: { id: string }) => r.id)).toEqual([r1.id]);
      expect(pending.body.data[0].handledBy).toBeNull();
      expect(pending.body.data[0].table.area).toEqual({ id: areaId, name: 'Sân vườn' });
      const open = await admin.get('/service-requests?status=pending,acknowledged');
      expect(open.body.meta.total).toBe(2);
      expect((await admin.get('/service-requests?status=closed')).status).toBe(400);

      expect((await admin.get('/service-requests?type=request_bill')).body.data[0].id).toBe(r2.id);
      expect((await admin.get(`/service-requests?tableId=${tables[1]!.id}`)).body.meta.total).toBe(
        1,
      );
      expect((await admin.get(`/service-requests?areaId=${areaId}`)).body.meta.total).toBe(2);

      const since = all.body.meta.serverTime as string;
      await new Promise((resolve) => setTimeout(resolve, 5));
      await admin.patch(`/service-requests/${r1.id}`, { status: 'done' });
      const delta = await admin.get(`/service-requests?updatedSince=${encodeURIComponent(since)}`);
      expect(delta.body.data.map((r: { id: string }) => r.id)).toEqual([r1.id]);
    });

    it('chuyển trạng thái: pending → acknowledged → done; không lùi / lặp', async () => {
      const sessionToken = await openSession();
      const req = (await guest(sessionToken).post({ type: 'call_staff' })).body.data;

      const ack = await admin.patch(`/service-requests/${req.id}`, { status: 'acknowledged' });
      expect(ack.status).toBe(200);
      expect(ack.body.data.status).toBe('acknowledged');
      expect(ack.body.data.acknowledgedAt).not.toBeNull();
      expect(ack.body.data.handledBy.id).toBe(userId);

      const ackAgain = await admin.patch(`/service-requests/${req.id}`, { status: 'acknowledged' });
      expect(ackAgain.status).toBe(409);
      expect(ackAgain.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      const done = await admin.patch(`/service-requests/${req.id}`, { status: 'done' });
      expect(done.status).toBe(200);
      expect(done.body.data.doneAt).not.toBeNull();

      const back = await admin.patch(`/service-requests/${req.id}`, { status: 'acknowledged' });
      expect(back.status).toBe(409);
      expect(back.body.error.details).toEqual({ from: 'done', to: 'acknowledged' });
      expect((await admin.patch(`/service-requests/${req.id}`, { status: 'pending' })).status).toBe(
        400,
      );
    });

    it('pending → done trực tiếp; 404 khi không tồn tại', async () => {
      const sessionToken = await openSession();
      const req = (await guest(sessionToken).post({ type: 'request_water' })).body.data;
      const done = await admin.patch(`/service-requests/${req.id}`, { status: 'done' });
      expect(done.status).toBe(200);
      expect(done.body.data.acknowledgedAt).toBeNull();
      expect(
        (await admin.patch('/service-requests/665f1c2e8b3a4d0012345678', { status: 'done' }))
          .status,
      ).toBe(404);
    });
  });
});
