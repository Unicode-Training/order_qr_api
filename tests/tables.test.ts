import JSZip from 'jszip';
import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { TableSession } from '../src/modules/sessions/tableSession.model';
import { Table } from '../src/modules/tables/table.model';
import { setTableStatus } from '../src/modules/tables/table.service';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Parser nhị phân cho supertest (PNG/ZIP). */
const binaryParser = (
  res: supertest.Response,
  callback: (err: Error | null, body: Buffer) => void,
): void => {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('Khu vực, bàn và mã QR', () => {
  let app: ReturnType<typeof createApp>;
  let bearer: string;

  const api = () => {
    const client = supertest(app);
    return {
      get: (url: string) => client.get(url).set('Authorization', bearer),
      post: (url: string) => client.post(url).set('Authorization', bearer),
      patch: (url: string) => client.patch(url).set('Authorization', bearer),
      delete: (url: string) => client.delete(url).set('Authorization', bearer),
    };
  };

  const createArea = async (name = 'Tầng 1 - Sảnh chính', sortOrder = 1) =>
    (await api().post('/api/v1/admin/areas').send({ name, sortOrder }).expect(201)).body.data as {
      id: string;
    };

  const createTable = async (body: Record<string, unknown>) =>
    (await api().post('/api/v1/admin/tables').send(body).expect(201)).body.data as {
      id: string;
      code: string;
      qrToken: string;
      qrUrl: string;
    };

  beforeEach(async () => {
    app = createApp();
    await createUser();
    bearer = `Bearer ${(await loginAs(app)).accessToken}`;
  });

  it.each([
    ['get', '/api/v1/admin/areas'],
    ['get', '/api/v1/admin/tables'],
    ['get', '/api/v1/admin/tables/stats'],
    ['get', '/api/v1/admin/tables/qr/export'],
    ['get', '/api/v1/admin/tables/665f1c2e8b3a4d0012345678/qr'],
    ['post', '/api/v1/admin/tables/665f1c2e8b3a4d0012345678/qr/regenerate'],
    ['patch', '/api/v1/admin/tables/665f1c2e8b3a4d0012345678/status'],
  ] as const)('%s %s không có token → 401', async (method, url) => {
    await supertest(app)[method](url).expect(401);
  });

  describe('Khu vực', () => {
    it('CRUD, sắp theo sortOrder, kèm tableCount; không xoá được khi còn bàn', async () => {
      const t2 = await createArea('Tầng 2', 2);
      const t1 = await createArea('Tầng 1 - Sảnh chính', 1);
      await createTable({ code: 'b01', areaId: t1.id });

      const list = await api().get('/api/v1/admin/areas').expect(200);
      expect(list.body.data.map((a: { name: string }) => a.name)).toEqual([
        'Tầng 1 - Sảnh chính',
        'Tầng 2',
      ]);
      expect(list.body.data[0].tableCount).toBe(1);

      const updated = await api()
        .patch(`/api/v1/admin/areas/${t2.id}`)
        .send({ name: 'Sân thượng' })
        .expect(200);
      expect(updated.body.data).toMatchObject({ name: 'Sân thượng', sortOrder: 2, tableCount: 0 });

      const blocked = await api().delete(`/api/v1/admin/areas/${t1.id}`).expect(409);
      expect(blocked.body.error.code).toBe('AREA_HAS_TABLES');

      await api().delete(`/api/v1/admin/areas/${t2.id}`).expect(200);
      await api().get(`/api/v1/admin/areas/${t2.id}`).expect(404);
      await api().post('/api/v1/admin/areas').send({ name: '' }).expect(400);
    });
  });

  describe('Bàn', () => {
    it('tạo bàn: mã viết hoa, tên mặc định, sinh qrToken ngẫu nhiên và qrUrl', async () => {
      const area = await createArea();
      const res = await api()
        .post('/api/v1/admin/tables')
        .send({ code: ' b08 ', areaId: area.id, capacity: 6 })
        .expect(201);

      expect(res.body.data).toMatchObject({
        code: 'B08',
        name: 'Bàn B08',
        areaId: area.id,
        area: { id: area.id, name: 'Tầng 1 - Sảnh chính' },
        capacity: 6,
        isActive: true,
        status: 'available',
      });
      expect(res.body.data.qrToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(res.body.data.qrUrl).toBe(`http://localhost:3000/t/${res.body.data.qrToken}`);

      const other = await createTable({ code: 'B09' });
      expect(other.qrToken).not.toBe(res.body.data.qrToken);
    });

    it('mã bàn trùng → 409; khu vực không tồn tại → 400; dữ liệu sai → 400', async () => {
      await createTable({ code: 'B01' });
      const dup = await api().post('/api/v1/admin/tables').send({ code: 'b01' }).expect(409);
      expect(dup.body.error.code).toBe('TABLE_CODE_EXISTS');

      const noArea = await api()
        .post('/api/v1/admin/tables')
        .send({ code: 'B02', areaId: '665f1c2e8b3a4d0012345678' })
        .expect(400);
      expect(noArea.body.error.code).toBe('AREA_NOT_FOUND');

      await api().post('/api/v1/admin/tables').send({ code: 'B 03', capacity: 0 }).expect(400);
    });

    it('danh sách lọc theo khu vực, trạng thái, tìm kiếm; sắp theo mã', async () => {
      const a1 = await createArea('Tầng 1', 1);
      const a2 = await createArea('Tầng 2', 2);
      const b02 = await createTable({ code: 'B02', areaId: a1.id });
      await createTable({ code: 'B01', areaId: a1.id });
      await createTable({ code: 'V01', name: 'Phòng VIP', areaId: a2.id });
      await createTable({ code: 'X01' });
      await setTableStatus(b02.id, 'occupied');

      const codes = (res: supertest.Response) => res.body.data.map((t: { code: string }) => t.code);

      const all = await api().get('/api/v1/admin/tables').expect(200);
      expect(codes(all)).toEqual(['B01', 'B02', 'V01', 'X01']);
      expect(all.body.meta.total).toBe(4);

      expect(codes(await api().get(`/api/v1/admin/tables?areaId=${a1.id}`))).toEqual([
        'B01',
        'B02',
      ]);
      expect(codes(await api().get('/api/v1/admin/tables?areaId=none'))).toEqual(['X01']);
      expect(codes(await api().get('/api/v1/admin/tables?status=occupied'))).toEqual(['B02']);
      expect(codes(await api().get('/api/v1/admin/tables?search=vip'))).toEqual(['V01']);
      await api().get('/api/v1/admin/tables?status=busy').expect(400);
    });

    it('cập nhật bàn; đổi mã trùng → 409; bỏ khu vực bằng areaId=null', async () => {
      const area = await createArea();
      const table = await createTable({ code: 'B01', areaId: area.id });
      await createTable({ code: 'B02' });

      const res = await api()
        .patch(`/api/v1/admin/tables/${table.id}`)
        .send({ code: 'b10', name: 'Bàn cửa sổ', capacity: 2, areaId: null })
        .expect(200);
      expect(res.body.data).toMatchObject({
        code: 'B10',
        name: 'Bàn cửa sổ',
        capacity: 2,
        areaId: null,
        area: null,
      });
      expect(res.body.data.qrToken).toBe(table.qrToken);

      await api().patch(`/api/v1/admin/tables/${table.id}`).send({ code: 'B02' }).expect(409);
      await api().patch(`/api/v1/admin/tables/${table.id}`).send({}).expect(400);
    });

    it('xoá bàn; bàn đang phục vụ → 409 TABLE_IN_USE', async () => {
      const busy = await createTable({ code: 'B01' });
      const free = await createTable({ code: 'B02' });
      await setTableStatus(busy.id, 'needs_payment');

      const res = await api().delete(`/api/v1/admin/tables/${busy.id}`).expect(409);
      expect(res.body.error.code).toBe('TABLE_IN_USE');

      await api().delete(`/api/v1/admin/tables/${free.id}`).expect(200);
      await api().get(`/api/v1/admin/tables/${free.id}`).expect(404);
    });

    it('thống kê: tổng, đang phục vụ, trống, chờ thanh toán (bỏ qua bàn đã tắt)', async () => {
      const area = await createArea();
      const ids = await Promise.all(
        ['B01', 'B02', 'B03', 'B04'].map(
          async (code) => (await createTable({ code, areaId: area.id })).id,
        ),
      );
      await createTable({ code: 'X01', isActive: false });
      await setTableStatus(ids[0]!, 'occupied');
      await setTableStatus(ids[1]!, 'occupied');
      await setTableStatus(ids[2]!, 'needs_payment');

      const res = await api().get('/api/v1/admin/tables/stats').expect(200);
      expect(res.body.data).toEqual({
        total: 4,
        occupied: 2,
        available: 1,
        needsPayment: 1,
        reserved: 0,
        inactive: 1,
      });

      const byArea = await api().get(`/api/v1/admin/tables/stats?areaId=${area.id}`).expect(200);
      expect(byArea.body.data).toMatchObject({ total: 4, inactive: 0 });
    });
  });

  describe('Đặt bàn trước PATCH /admin/tables/:id/status', () => {
    const setStatus = (id: string, body: Record<string, unknown>) =>
      api().patch(`/api/v1/admin/tables/${id}/status`).send(body);

    it('available → reserved (kèm ghi chú) → available, thống kê đếm reserved', async () => {
      const table = await createTable({ code: 'B01' });

      const reserved = await setStatus(table.id, {
        status: 'reserved',
        reservationNote: '  Anh Minh - 19:00  ',
      }).expect(200);
      expect(reserved.body.data).toMatchObject({
        id: table.id,
        status: 'reserved',
        reservationNote: 'Anh Minh - 19:00',
      });
      const stats = await api().get('/api/v1/admin/tables/stats').expect(200);
      expect(stats.body.data).toMatchObject({ reserved: 1, available: 0 });

      // reserved → reserved: cập nhật ghi chú
      const renamed = await setStatus(table.id, { status: 'reserved' }).expect(200);
      expect(renamed.body.data.reservationNote).toBeNull();

      const back = await setStatus(table.id, { status: 'available' }).expect(200);
      expect(back.body.data).toMatchObject({ status: 'available', reservationNote: null });
      const detail = await api().get(`/api/v1/admin/tables/${table.id}`).expect(200);
      expect(detail.body.data).toMatchObject({ status: 'available', reservationNote: null });
    });

    it('body không hợp lệ → 400; bàn không tồn tại → 404', async () => {
      const table = await createTable({ code: 'B01' });
      await setStatus(table.id, { status: 'occupied' }).expect(400);
      await setStatus(table.id, {}).expect(400);
      await setStatus(table.id, { status: 'reserved', reservationNote: 'x'.repeat(201) }).expect(
        400,
      );
      await setStatus(table.id, { status: 'available', reservationNote: 'ghi chú' }).expect(400);
      await setStatus('665f1c2e8b3a4d0012345678', { status: 'reserved' }).expect(404);
    });

    it('bàn đang phục vụ / chờ thanh toán / có phiên chưa đóng → 409 TABLE_IN_USE', async () => {
      const occupied = await createTable({ code: 'B01' });
      const needsPayment = await createTable({ code: 'B02' });
      await setTableStatus(occupied.id, 'occupied');
      await setTableStatus(needsPayment.id, 'needs_payment');

      for (const [id, status] of [
        [occupied.id, 'reserved'],
        [occupied.id, 'available'],
        [needsPayment.id, 'reserved'],
      ] as const) {
        const res = await setStatus(id, { status }).expect(409);
        expect(res.body.error.code).toBe('TABLE_IN_USE');
      }
      expect((await Table.findById(occupied.id).lean())!.status).toBe('occupied');

      // Trạng thái bàn lệch nhưng còn phiên chưa đóng → vẫn chặn
      const withSession = await createTable({ code: 'B03' });
      await TableSession.create({ tableId: withSession.id });
      const res = await setStatus(withSession.id, { status: 'reserved' }).expect(409);
      expect(res.body.error.code).toBe('TABLE_IN_USE');
      expect((await Table.findById(withSession.id).lean())!.status).toBe('available');
    });

    it('bàn đã tắt → 409 TABLE_INACTIVE', async () => {
      const table = await createTable({ code: 'B01', isActive: false });
      const res = await setStatus(table.id, { status: 'reserved' }).expect(409);
      expect(res.body.error.code).toBe('TABLE_INACTIVE');
      expect((await Table.findById(table.id).lean())!.status).toBe('available');
    });

    it('khách vẫn mở phiên trên bàn reserved → bàn occupied, xoá ghi chú; không đổi được nữa', async () => {
      const table = await createTable({ code: 'B01' });
      await setStatus(table.id, { status: 'reserved', reservationNote: 'Chị Lan' }).expect(200);

      const opened = await supertest(app)
        .post('/api/v1/public/sessions')
        .send({ qrToken: table.qrToken, guestCount: 2 })
        .expect(201);
      expect(opened.body.data.isNew).toBe(true);

      const detail = await api().get(`/api/v1/admin/tables/${table.id}`).expect(200);
      expect(detail.body.data).toMatchObject({ status: 'occupied', reservationNote: null });

      const res = await setStatus(table.id, { status: 'available' }).expect(409);
      expect(res.body.error.code).toBe('TABLE_IN_USE');
    });
  });

  describe('Mã QR', () => {
    it('GET /:id/qr trả PNG (mặc định) với đúng content-type', async () => {
      const table = await createTable({ code: 'B08' });
      const res = await api()
        .get(`/api/v1/admin/tables/${table.id}/qr?size=256`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['content-disposition']).toContain('inline; filename="qr-B08.png"');
      const body = res.body as Buffer;
      expect(body.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
      expect(body.readUInt32BE(16)).toBe(256); // chiều rộng trong IHDR
    });

    it('GET /:id/qr?format=svg trả SVG; download=true → attachment', async () => {
      const table = await createTable({ code: 'B08' });
      const res = await api()
        .get(`/api/v1/admin/tables/${table.id}/qr?format=svg&download=true`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
      expect(res.headers['content-disposition']).toContain('attachment; filename="qr-B08.svg"');
      expect((res.body as Buffer).toString('utf8')).toContain('<svg');
    });

    it('tham số QR sai → 400; bàn không tồn tại → 404', async () => {
      const table = await createTable({ code: 'B08' });
      await api().get(`/api/v1/admin/tables/${table.id}/qr?format=jpg`).expect(400);
      await api().get(`/api/v1/admin/tables/${table.id}/qr?size=10`).expect(400);
      await api().get('/api/v1/admin/tables/665f1c2e8b3a4d0012345678/qr').expect(404);
    });

    it('xuất ZIP các PNG của bàn đang hoạt động; lọc theo khu vực', async () => {
      const area = await createArea();
      await createTable({ code: 'B01', areaId: area.id });
      await createTable({ code: 'B02', areaId: area.id });
      await createTable({ code: 'X01' });
      await createTable({ code: 'X02', isActive: false });

      const res = await api()
        .get('/api/v1/admin/tables/qr/export?size=128')
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      expect(res.headers['content-type']).toBe('application/zip');
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename=".+\.zip"$/);

      const zip = await JSZip.loadAsync(res.body as Buffer);
      expect(Object.keys(zip.files).sort()).toEqual(['B01.png', 'B02.png', 'X01.png']);
      const png = await zip.file('B01.png')!.async('nodebuffer');
      expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);

      const byArea = await api()
        .get(`/api/v1/admin/tables/qr/export?areaId=${area.id}`)
        .buffer(true)
        .parse(binaryParser)
        .expect(200);
      const areaZip = await JSZip.loadAsync(byArea.body as Buffer);
      expect(Object.keys(areaZip.files).sort()).toEqual(['B01.png', 'B02.png']);

      await api().get('/api/v1/admin/tables/qr/export?areaId=665f1c2e8b3a4d0012345678').expect(404);
    });
  });

  describe('Public resolve /api/v1/public/tables/resolve/:qrToken', () => {
    it('trả bàn + thông tin nhà hàng công khai, không cần đăng nhập', async () => {
      const area = await createArea();
      const table = await createTable({ code: 'B08', name: 'Bàn 08', areaId: area.id });

      const res = await supertest(app)
        .get(`/api/v1/public/tables/resolve/${table.qrToken}`)
        .expect(200);
      expect(res.body.data.table).toEqual({
        id: table.id,
        code: 'B08',
        name: 'Bàn 08',
        area: { id: area.id, name: 'Tầng 1 - Sảnh chính' },
      });
      expect(res.body.data.restaurant).toMatchObject({
        name: 'Nhà hàng của tôi',
        isOpenNow: expect.any(Boolean),
      });
      expect(JSON.stringify(res.body)).not.toContain(table.qrToken);
    });

    it('regenerate làm token cũ 404, token mới dùng được', async () => {
      const table = await createTable({ code: 'B08' });

      const regen = await api().post(`/api/v1/admin/tables/${table.id}/qr/regenerate`).expect(200);
      const newToken = regen.body.data.qrToken as string;
      expect(newToken).not.toBe(table.qrToken);
      expect(regen.body.data.qrUrl).toBe(`http://localhost:3000/t/${newToken}`);

      const old = await supertest(app)
        .get(`/api/v1/public/tables/resolve/${table.qrToken}`)
        .expect(404);
      expect(old.body.error.code).toBe('TABLE_NOT_FOUND');
      await supertest(app).get(`/api/v1/public/tables/resolve/${newToken}`).expect(200);
    });

    it('token sai hoặc bàn đã tắt → 404', async () => {
      const table = await createTable({ code: 'B08' });
      await supertest(app).get('/api/v1/public/tables/resolve/khong-ton-tai-123456').expect(404);
      await supertest(app).get('/api/v1/public/tables/resolve/x').expect(404);

      await Table.updateOne({ _id: table.id }, { isActive: false });
      await supertest(app).get(`/api/v1/public/tables/resolve/${table.qrToken}`).expect(404);
    });
  });
});
