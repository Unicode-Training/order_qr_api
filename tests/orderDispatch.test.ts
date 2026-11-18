import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Area } from '../src/modules/areas/area.model';
import { Category } from '../src/modules/menu/category.model';
import { MenuItem } from '../src/modules/menu/menuItem.model';
import { Order, type OrderStatus } from '../src/modules/orders/order.model';
import { toBusinessDate } from '../src/modules/orders/order.service';
import {
  ORDER_STATUS_TRANSITIONS,
  canTransition,
  canTransitionItem,
} from '../src/modules/orders/orderStatus';
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
const CLOSED_ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, slots: [] }));

describe('State machine trạng thái đơn', () => {
  const ALL: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled'];
  const VALID = new Set([
    'pending>confirmed',
    'pending>cancelled',
    'confirmed>preparing',
    'confirmed>cancelled',
    'preparing>ready',
    'ready>served',
  ]);

  it('chỉ cho phép đúng các bước đã định nghĩa', () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(VALID.has(`${from}>${to}`));
      }
    }
    expect(ORDER_STATUS_TRANSITIONS.served).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });

  it('món chỉ tiến lên hoặc bị huỷ khi chưa served', () => {
    expect(canTransitionItem('confirmed', 'preparing')).toBe(true);
    expect(canTransitionItem('confirmed', 'served')).toBe(true);
    expect(canTransitionItem('ready', 'preparing')).toBe(false);
    expect(canTransitionItem('ready', 'ready')).toBe(false);
    expect(canTransitionItem('preparing', 'cancelled')).toBe(true);
    expect(canTransitionItem('served', 'cancelled')).toBe(false);
    expect(canTransitionItem('cancelled', 'ready')).toBe(false);
  });
});

describe('Điều phối đơn cho nhân viên/bếp', () => {
  let app: ReturnType<typeof createApp>;
  let token: string;
  let userId: string;
  let table: { id: string; qrToken: string };
  let otherTable: { id: string; qrToken: string };
  let areaId: string;
  let pho: string;
  let tra: string;

  const api = () => supertest(app);
  const admin = {
    get: (url: string) => api().get(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object) =>
      api().post(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) =>
      api().patch(`/api/v1/admin${url}`).set('Authorization', `Bearer ${token}`).send(body),
  };

  async function guestToken(qrToken: string) {
    const res = await api().post('/api/v1/public/sessions').send({ qrToken });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return res.body.data.sessionToken as string;
  }

  async function guestOrder(qrToken = table.qrToken, items?: object[]) {
    const sessionToken = await guestToken(qrToken);
    const res = await api()
      .post('/api/v1/public/orders')
      .set('X-Session-Token', sessionToken)
      .send({
        items: items ?? [
          { menuItemId: pho, quantity: 2 },
          { menuItemId: tra, quantity: 3 },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; orderNumber: string; items: { id: string }[] };
  }

  beforeEach(async () => {
    app = createApp();
    await replaceSettings(
      restaurantSettingsSchema.parse({
        name: 'Quán Test',
        openingHours: ALL_DAY,
        ordering: { requireStaffConfirm: true, maxItemQuantityPerOrder: 10 },
      }),
    );
    const user = await createUser({ fullName: 'Chị Bếp' });
    userId = user._id.toString();
    ({ accessToken: token } = await loginAs(app));

    const area = await Area.create({ name: 'Tầng 1' });
    areaId = area._id.toString();
    const t1 = await Table.create({ code: 'B01', name: 'Bàn 1', areaId: area._id });
    const t2 = await Table.create({ code: 'B02', name: 'Bàn 2' });
    table = { id: t1._id.toString(), qrToken: t1.qrToken };
    otherTable = { id: t2._id.toString(), qrToken: t2.qrToken };

    const category = await Category.create({ name: 'Món chính', slug: 'mon-chinh' });
    pho = (
      await MenuItem.create({
        name: 'Phở bò',
        slug: 'pho-bo',
        categoryId: category._id,
        price: 60000,
      })
    )._id.toString();
    tra = (
      await MenuItem.create({
        name: 'Trà đá',
        slug: 'tra-da',
        categoryId: category._id,
        price: 5000,
      })
    )._id.toString();
  });

  it('yêu cầu đăng nhập', async () => {
    expect((await api().get('/api/v1/admin/orders')).status).toBe(401);
    expect((await api().get('/api/v1/admin/service-requests')).status).toBe(401);
  });

  describe('PATCH /admin/orders/:id/status', () => {
    it('đi hết vòng đời, ghi statusHistory kèm nhân viên, kéo theo trạng thái món', async () => {
      const order = await guestOrder();
      for (const status of ['confirmed', 'preparing', 'ready', 'served'] as const) {
        const res = await admin.patch(`/orders/${order.id}/status`, { status });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.status).toBe(status);
        expect(
          res.body.data.items.every((i: { itemStatus: string }) => i.itemStatus === status),
        ).toBe(true);
      }
      const detail = await admin.get(`/orders/${order.id}`);
      expect(detail.status).toBe(200);
      const history = detail.body.data.statusHistory;
      expect(history.map((h: { status: string }) => h.status)).toEqual([
        'pending',
        'confirmed',
        'preparing',
        'ready',
        'served',
      ]);
      expect(history[0].by).toBe('guest');
      expect(history[0].byUser).toBeNull();
      expect(history[1]).toMatchObject({
        by: 'staff',
        byUser: { id: userId, fullName: 'Chị Bếp' },
      });
      expect(detail.body.data.allowedNextStatuses).toEqual([]);
      expect(detail.body.data.table).toMatchObject({
        id: table.id,
        code: 'B01',
        area: { id: areaId, name: 'Tầng 1' },
      });
    });

    it('chặn bước không hợp lệ → 409 INVALID_STATUS_TRANSITION', async () => {
      const order = await guestOrder();
      const skip = await admin.patch(`/orders/${order.id}/status`, { status: 'ready' });
      expect(skip.status).toBe(409);
      expect(skip.body.error.code).toBe('INVALID_STATUS_TRANSITION');
      expect(skip.body.error.details).toEqual({
        from: 'pending',
        to: 'ready',
        allowed: ['confirmed', 'cancelled'],
      });

      await admin.patch(`/orders/${order.id}/status`, { status: 'confirmed' });
      await admin.patch(`/orders/${order.id}/status`, { status: 'preparing' });
      const cancelLate = await admin.patch(`/orders/${order.id}/status`, {
        status: 'cancelled',
        reason: 'Khách đổi ý',
      });
      expect(cancelLate.status).toBe(409);
      const back = await admin.patch(`/orders/${order.id}/status`, { status: 'confirmed' });
      expect(back.status).toBe(409);
      const same = await admin.patch(`/orders/${order.id}/status`, { status: 'preparing' });
      expect(same.status).toBe(409);
    });

    it('huỷ đơn bắt buộc lý do; huỷ thành công huỷ mọi món', async () => {
      const order = await guestOrder();
      const noReason = await admin.patch(`/orders/${order.id}/status`, { status: 'cancelled' });
      expect(noReason.status).toBe(400);
      expect(noReason.body.error.details[0].path).toBe('reason');
      const blank = await admin.patch(`/orders/${order.id}/status`, {
        status: 'cancelled',
        reason: '   ',
      });
      expect(blank.status).toBe(400);

      const res = await admin.patch(`/orders/${order.id}/status`, {
        status: 'cancelled',
        reason: 'Khách về',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
      expect(
        res.body.data.items.every((i: { itemStatus: string }) => i.itemStatus === 'cancelled'),
      ).toBe(true);
      expect(res.body.data.statusHistory.at(-1)).toMatchObject({
        status: 'cancelled',
        by: 'staff',
        note: 'Khách về',
      });
      const again = await admin.patch(`/orders/${order.id}/status`, { status: 'confirmed' });
      expect(again.status).toBe(409);
    });

    it('hai nhân viên bấm cùng lúc: chỉ một người thành công', async () => {
      const order = await guestOrder();
      const results = await Promise.all([
        admin.patch(`/orders/${order.id}/status`, { status: 'confirmed' }),
        admin.patch(`/orders/${order.id}/status`, { status: 'confirmed' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const saved = await Order.findById(order.id).lean();
      expect(saved!.statusHistory.filter((h) => h.status === 'confirmed')).toHaveLength(1);
    });

    it('404 khi không có đơn, 400 khi id sai', async () => {
      expect(
        (await admin.patch('/orders/665f1c2e8b3a4d0012345678/status', { status: 'confirmed' }))
          .status,
      ).toBe(404);
      expect((await admin.patch('/orders/abc/status', { status: 'confirmed' })).status).toBe(400);
      expect((await admin.get('/orders/665f1c2e8b3a4d0012345678')).status).toBe(404);
    });
  });

  describe('PATCH /admin/orders/:id/items/:itemId', () => {
    it('cập nhật trạng thái từng món (chỉ tiến lên)', async () => {
      const order = await guestOrder();
      const [phoLine] = order.items;
      const pending = await admin.patch(`/orders/${order.id}/items/${phoLine!.id}`, {
        itemStatus: 'preparing',
      });
      expect(pending.status).toBe(409);
      expect(pending.body.error.code).toBe('ORDER_NOT_CONFIRMED');

      await admin.patch(`/orders/${order.id}/status`, { status: 'confirmed' });
      const ready = await admin.patch(`/orders/${order.id}/items/${phoLine!.id}`, {
        itemStatus: 'ready',
      });
      expect(ready.status).toBe(200);
      expect(ready.body.data.items[0].itemStatus).toBe('ready');
      expect(ready.body.data.items[1].itemStatus).toBe('confirmed');

      const back = await admin.patch(`/orders/${order.id}/items/${phoLine!.id}`, {
        itemStatus: 'preparing',
      });
      expect(back.status).toBe(409);
      expect(back.body.error.code).toBe('INVALID_ITEM_STATUS_TRANSITION');

      // Đơn chuyển preparing không kéo lùi món đã ready
      const preparing = await admin.patch(`/orders/${order.id}/status`, { status: 'preparing' });
      expect(preparing.body.data.items.map((i: { itemStatus: string }) => i.itemStatus)).toEqual([
        'ready',
        'preparing',
      ]);
    });

    it('huỷ món cần lý do và tính lại subtotal', async () => {
      const order = await guestOrder();
      const [phoLine, traLine] = order.items;
      const noReason = await admin.patch(`/orders/${order.id}/items/${traLine!.id}`, {
        itemStatus: 'cancelled',
      });
      expect(noReason.status).toBe(400);

      // Đơn pending vẫn huỷ món được
      const res = await admin.patch(`/orders/${order.id}/items/${traLine!.id}`, {
        itemStatus: 'cancelled',
        reason: 'Khách không lấy nữa',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.subtotal).toBe(120000);
      expect(res.body.data.totals.subtotal).toBe(120000);
      expect(res.body.data.items[1]).toMatchObject({
        itemStatus: 'cancelled',
        cancelReason: 'Khách không lấy nữa',
      });
      expect(res.body.data.status).toBe('pending');
      expect(phoLine).toBeDefined();

      // Tổng tạm tính của phiên không tính món đã huỷ
      const session = await TableSession.findOne({ tableId: table.id }).lean();
      const current = await api()
        .get('/api/v1/public/sessions/current')
        .set('X-Session-Token', session!.sessionToken);
      expect(current.body.data.bill.subtotal).toBe(120000);
      expect(current.body.data.bill.itemCount).toBe(2);
    });

    it('markSoldOut: huỷ món "Hết món" + món trong thực đơn thành hết', async () => {
      const order = await guestOrder();
      await admin.patch(`/orders/${order.id}/status`, { status: 'confirmed' });
      const res = await admin.patch(`/orders/${order.id}/items/${order.items[0]!.id}`, {
        markSoldOut: true,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.items[0]).toMatchObject({
        itemStatus: 'cancelled',
        cancelReason: 'Hết món',
      });
      expect(res.body.data.subtotal).toBe(15000);
      expect((await MenuItem.findById(pho).lean())!.isAvailable).toBe(false);

      const bad = await admin.patch(`/orders/${order.id}/items/${order.items[1]!.id}`, {
        markSoldOut: true,
        itemStatus: 'ready',
      });
      expect(bad.status).toBe(400);
      expect(
        (await admin.patch(`/orders/${order.id}/items/${order.items[1]!.id}`, {})).status,
      ).toBe(400);
    });

    it('huỷ hết mọi món → đơn tự huỷ; đơn đã kết thúc không sửa được', async () => {
      const order = await guestOrder(table.qrToken, [{ menuItemId: pho, quantity: 1 }]);
      const res = await admin.patch(`/orders/${order.id}/items/${order.items[0]!.id}`, {
        itemStatus: 'cancelled',
        reason: 'Hết nguyên liệu',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
      expect(res.body.data.subtotal).toBe(0);
      expect(res.body.data.statusHistory.at(-1)).toMatchObject({
        status: 'cancelled',
        by: 'staff',
      });

      const closed = await admin.patch(`/orders/${order.id}/items/${order.items[0]!.id}`, {
        itemStatus: 'ready',
      });
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe('ORDER_CLOSED');
    });

    it('404 khi món không thuộc đơn', async () => {
      const order = await guestOrder();
      const res = await admin.patch(`/orders/${order.id}/items/665f1c2e8b3a4d0012345678`, {
        itemStatus: 'cancelled',
        reason: 'x',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /admin/orders', () => {
    it('lọc theo nhiều trạng thái, bàn, khu vực, ngày, mã đơn; phân trang', async () => {
      const a = await guestOrder();
      const b = await guestOrder();
      const c = await guestOrder(otherTable.qrToken);
      await admin.patch(`/orders/${b.id}/status`, { status: 'confirmed' });
      await admin.patch(`/orders/${c.id}/status`, { status: 'cancelled', reason: 'test' });

      const all = await admin.get('/orders');
      expect(all.status).toBe(200);
      expect(all.body.data.map((o: { id: string }) => o.id)).toEqual([c.id, b.id, a.id]);
      expect(all.body.meta).toMatchObject({ page: 1, total: 3 });
      expect(all.body.meta.serverTime).toBeDefined();

      const multi = await admin.get('/orders?status=pending,confirmed');
      expect(multi.body.data.map((o: { id: string }) => o.id).sort()).toEqual([a.id, b.id].sort());
      expect((await admin.get('/orders?status=pending,bogus')).status).toBe(400);

      expect((await admin.get(`/orders?tableId=${otherTable.id}`)).body.data).toHaveLength(1);
      expect((await admin.get(`/orders?areaId=${areaId}`)).body.meta.total).toBe(2);
      expect(
        (await admin.get(`/orders?areaId=${areaId}&tableId=${otherTable.id}`)).body.meta.total,
      ).toBe(0);

      const today = toBusinessDate(new Date());
      expect((await admin.get(`/orders?dateFrom=${today}&dateTo=${today}`)).body.meta.total).toBe(
        3,
      );
      expect((await admin.get('/orders?dateTo=2000-01-01')).body.meta.total).toBe(0);
      expect((await admin.get('/orders?dateFrom=2026-02-01&dateTo=2026-01-01')).status).toBe(400);

      const search = await admin.get(`/orders?search=${b.orderNumber.slice(-4)}`);
      expect(search.body.data.map((o: { id: string }) => o.id)).toEqual([b.id]);
      expect((await admin.get('/orders?search=(')).status).toBe(200);

      const page2 = await admin.get('/orders?limit=2&page=2');
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.meta.totalPages).toBe(2);
    });

    it('updatedSince chỉ trả đơn có thay đổi sau lần polling trước', async () => {
      const a = await guestOrder();
      await guestOrder();
      const first = await admin.get('/orders');
      const since = first.body.meta.serverTime as string;
      await new Promise((resolve) => setTimeout(resolve, 5));
      await admin.patch(`/orders/${a.id}/status`, { status: 'confirmed' });

      const delta = await admin.get(`/orders?updatedSince=${encodeURIComponent(since)}`);
      expect(delta.status).toBe(200);
      expect(delta.body.data.map((o: { id: string }) => o.id)).toEqual([a.id]);
      expect((await admin.get('/orders?updatedSince=hom-qua')).status).toBe(400);
    });
  });

  describe('GET /admin/orders/board', () => {
    it('gom theo cột trạng thái trong ngày kèm số đếm', async () => {
      const a = await guestOrder();
      const b = await guestOrder();
      const c = await guestOrder(otherTable.qrToken);
      const d = await guestOrder(otherTable.qrToken);
      await admin.patch(`/orders/${b.id}/status`, { status: 'confirmed' });
      await admin.patch(`/orders/${c.id}/status`, { status: 'confirmed' });
      await admin.patch(`/orders/${c.id}/status`, { status: 'preparing' });
      await admin.patch(`/orders/${d.id}/status`, { status: 'cancelled', reason: 'x' });
      // Đơn của ngày khác không xuất hiện
      await Order.updateOne({ _id: a.id }, { $set: { businessDate: '2000-01-01' } });
      const e = await guestOrder();

      const res = await admin.get('/orders/board');
      expect(res.status).toBe(200);
      const board = res.body.data;
      expect(board.date).toBe(toBusinessDate(new Date()));
      expect(board.columns.map((col: { status: string }) => col.status)).toEqual([
        'pending',
        'confirmed',
        'preparing',
        'ready',
        'served',
      ]);
      const ids = (status: string) =>
        board.columns
          .find((col: { status: string }) => col.status === status)
          .orders.map((o: { id: string }) => o.id);
      expect(ids('pending')).toEqual([e.id]);
      expect(ids('confirmed')).toEqual([b.id]);
      expect(ids('preparing')).toEqual([c.id]);
      expect(board.counts).toEqual({
        pending: 1,
        confirmed: 1,
        preparing: 1,
        ready: 0,
        served: 0,
        cancelled: 1,
        total: 4,
      });
      expect(board.columns[1].count).toBe(1);

      const byArea = await admin.get(`/orders/board?areaId=${areaId}`);
      expect(byArea.body.data.counts.total).toBe(2);
      const old = await admin.get('/orders/board?date=2000-01-01');
      expect(old.body.data.counts.total).toBe(1);
      expect((await admin.get('/orders/board?date=18-11-2026')).status).toBe(400);
    });
  });

  describe('POST /admin/tables/:id/orders', () => {
    it('tự mở phiên nếu bàn chưa có, đơn ở trạng thái confirmed', async () => {
      const res = await admin.post(`/tables/${otherTable.id}/orders`, {
        items: [{ menuItemId: pho, quantity: 1 }],
        note: 'Khách gọi tại quầy',
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.meta).toEqual({ sessionCreated: true });
      expect(res.body.data).toMatchObject({
        status: 'confirmed',
        tableId: otherTable.id,
        subtotal: 60000,
        note: 'Khách gọi tại quầy',
      });
      expect(res.body.data.items[0].itemStatus).toBe('confirmed');
      expect(res.body.data.statusHistory.map((h: { by: string }) => h.by)).toEqual([
        'staff',
        'staff',
      ]);
      expect(res.body.data.statusHistory[0].byUser.id).toBe(userId);
      expect((await Table.findById(otherTable.id).lean())!.status).toBe('occupied');

      // Lần 2 dùng lại phiên; khách quét QR vào cùng phiên đó
      const again = await admin.post(`/tables/${otherTable.id}/orders`, {
        items: [{ menuItemId: tra, quantity: 2 }],
      });
      expect(again.body.meta.sessionCreated).toBe(false);
      expect(again.body.data.sessionId).toBe(res.body.data.sessionId);
      const sessionToken = await guestToken(otherTable.qrToken);
      const guestOrders = await api()
        .get('/api/v1/public/sessions/current/orders')
        .set('X-Session-Token', sessionToken);
      expect(guestOrders.body.data).toHaveLength(2);
    });

    it('không bị chặn bởi giờ mở cửa / tắt đặt món qua QR', async () => {
      await replaceSettings(
        restaurantSettingsSchema.parse({
          name: 'Quán Test',
          openingHours: CLOSED_ALL_WEEK,
          ordering: { enabled: false },
        }),
      );
      const res = await admin.post(`/tables/${table.id}/orders`, {
        items: [{ menuItemId: pho, quantity: 1 }],
      });
      expect(res.status).toBe(201);
    });

    it('validate món, bàn không tồn tại, bàn đã tắt, phiên chờ thanh toán', async () => {
      await MenuItem.updateOne({ _id: tra }, { isAvailable: false });
      const invalid = await admin.post(`/tables/${table.id}/orders`, {
        items: [{ menuItemId: tra, quantity: 1 }],
      });
      expect(invalid.status).toBe(422);
      expect(await TableSession.countDocuments()).toBe(0);

      const line = { items: [{ menuItemId: pho, quantity: 1 }] };
      expect((await admin.post('/tables/665f1c2e8b3a4d0012345678/orders', line)).status).toBe(404);
      await Table.updateOne({ _id: otherTable.id }, { isActive: false });
      const inactive = await admin.post(`/tables/${otherTable.id}/orders`, line);
      expect(inactive.status).toBe(409);
      expect(inactive.body.error.code).toBe('TABLE_INACTIVE');

      await TableSession.create({ tableId: table.id, status: 'payment_requested' });
      const paying = await admin.post(`/tables/${table.id}/orders`, line);
      expect(paying.status).toBe(409);
      expect(paying.body.error.code).toBe('SESSION_NOT_OPEN');
    });
  });
});
