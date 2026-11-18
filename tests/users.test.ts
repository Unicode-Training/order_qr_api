import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { User } from '../src/modules/users/user.model';
import { disableUser } from '../src/modules/users/user.service';
import { createUser, DEFAULT_PASSWORD, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

describe('Admin router /api/v1/admin', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
  });

  it.each([
    ['get', '/api/v1/admin/users'],
    ['post', '/api/v1/admin/users'],
    ['get', '/api/v1/admin/users/665f1c2e8b3a4d0012345678'],
    ['patch', '/api/v1/admin/users/665f1c2e8b3a4d0012345678'],
    ['delete', '/api/v1/admin/users/665f1c2e8b3a4d0012345678'],
    ['get', '/api/v1/admin/khong-ton-tai'],
  ] as const)('%s %s không có token → 401', async (method, url) => {
    const res = await supertest(app)[method](url);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('token sai chữ ký → 401', async () => {
    const res = await supertest(app)
      .get('/api/v1/admin/users')
      .set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
  });

  it('access token của user đã bị vô hiệu hoá → 401 ngay lập tức', async () => {
    const user = await createUser();
    const { accessToken } = await loginAs(app);
    await User.updateOne({ _id: user._id }, { isActive: false });

    const res = await supertest(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(401);
  });

  it('router /api/v1/public không yêu cầu đăng nhập', async () => {
    const res = await supertest(app).get('/api/v1/public/khong-ton-tai');
    expect(res.status).toBe(404);
  });
});

describe('Quản lý tài khoản /api/v1/admin/users', () => {
  let app: ReturnType<typeof createApp>;
  let auth: { accessToken: string; userId: string };

  const api = () => {
    const client = supertest(app);
    const bearer = `Bearer ${auth.accessToken}`;
    return {
      get: (url: string) => client.get(url).set('Authorization', bearer),
      post: (url: string) => client.post(url).set('Authorization', bearer),
      patch: (url: string) => client.patch(url).set('Authorization', bearer),
      delete: (url: string) => client.delete(url).set('Authorization', bearer),
    };
  };

  beforeEach(async () => {
    app = createApp();
    await createUser({ email: 'admin@example.com', fullName: 'Admin' });
    auth = await loginAs(app);
  });

  it('tạo tài khoản mới, đăng nhập được, không trả passwordHash', async () => {
    const res = await api()
      .post('/api/v1/admin/users')
      .send({ fullName: 'Nhân viên A', email: 'NV.A@Example.com', password: 'Secret@123' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      fullName: 'Nhân viên A',
      email: 'nv.a@example.com',
      isActive: true,
      lastLoginAt: null,
    });
    expect(res.body.data.passwordHash).toBeUndefined();
    await loginAs(app, 'nv.a@example.com', 'Secret@123');
  });

  it('tạo trùng email → 409', async () => {
    const res = await api()
      .post('/api/v1/admin/users')
      .send({ fullName: 'Trùng', email: 'admin@example.com', password: 'Secret@123' });
    expect(res.status).toBe(409);
  });

  it('dữ liệu tạo không hợp lệ → 400', async () => {
    const res = await api()
      .post('/api/v1/admin/users')
      .send({ fullName: '', email: 'x', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('danh sách có phân trang, tìm kiếm, lọc isActive', async () => {
    await createUser({ email: 'b@example.com', fullName: 'Bếp trưởng' });
    await createUser({ email: 'c@example.com', fullName: 'Thu ngân', isActive: false });

    const all = await api().get('/api/v1/admin/users?limit=2&sort=email');
    expect(all.status).toBe(200);
    expect(all.body.data).toHaveLength(2);
    expect(all.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(JSON.stringify(all.body)).not.toMatch(/passwordHash/);

    const search = await api().get('/api/v1/admin/users?search=bếp');
    expect(search.body.data.map((u: { email: string }) => u.email)).toEqual(['b@example.com']);

    const inactive = await api().get('/api/v1/admin/users?isActive=false');
    expect(inactive.body.data.map((u: { email: string }) => u.email)).toEqual(['c@example.com']);
  });

  it('xem chi tiết; id không tồn tại → 404; id sai định dạng → 400', async () => {
    const res = await api().get(`/api/v1/admin/users/${auth.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(auth.userId);

    await api().get('/api/v1/admin/users/665f1c2e8b3a4d0012345678').expect(404);
    await api().get('/api/v1/admin/users/abc').expect(400);
  });

  it('cập nhật họ tên/email; email trùng → 409', async () => {
    const other = await createUser({ email: 'b@example.com' });

    const res = await api()
      .patch(`/api/v1/admin/users/${other._id.toString()}`)
      .send({ fullName: 'Tên mới', email: 'B2@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fullName: 'Tên mới', email: 'b2@example.com' });

    await api()
      .patch(`/api/v1/admin/users/${other._id.toString()}`)
      .send({ email: 'admin@example.com' })
      .expect(409);
    await api().patch(`/api/v1/admin/users/${other._id.toString()}`).send({}).expect(400);
  });

  it('đặt lại mật khẩu cho tài khoản khác', async () => {
    const other = await createUser({ email: 'b@example.com' });
    await api()
      .patch(`/api/v1/admin/users/${other._id.toString()}`)
      .send({ password: 'Reset@12345' })
      .expect(200);
    await loginAs(app, 'b@example.com', 'Reset@12345');
  });

  it('DELETE vô hiệu hoá mềm: user không đăng nhập được, phiên cũ bị thu hồi', async () => {
    await createUser({ email: 'b@example.com' });
    const otherSession = await loginAs(app, 'b@example.com');

    const res = await api().delete(`/api/v1/admin/users/${otherSession.userId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect(await User.countDocuments({ email: 'b@example.com' })).toBe(1);

    await supertest(app)
      .post('/api/v1/auth/login')
      .send({ email: 'b@example.com', password: DEFAULT_PASSWORD })
      .expect(403);
    await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: otherSession.refreshToken })
      .expect(401);

    // Kích hoạt lại
    await api()
      .patch(`/api/v1/admin/users/${otherSession.userId}`)
      .send({ isActive: true })
      .expect(200);
    await loginAs(app, 'b@example.com');
  });

  it('không thể tự vô hiệu hoá chính mình (PATCH và DELETE)', async () => {
    const del = await api().delete(`/api/v1/admin/users/${auth.userId}`);
    expect(del.status).toBe(400);
    expect(del.body.error.code).toBe('CANNOT_DISABLE_SELF');

    const patch = await api().patch(`/api/v1/admin/users/${auth.userId}`).send({ isActive: false });
    expect(patch.status).toBe(400);
    expect(patch.body.error.code).toBe('CANNOT_DISABLE_SELF');
  });

  it('luôn còn ít nhất một tài khoản active', async () => {
    // Tình huống: tài khoản đang thao tác là active duy nhất bên cạnh target → vẫn được phép
    const other = await createUser({ email: 'b@example.com' });
    await api().delete(`/api/v1/admin/users/${other._id.toString()}`).expect(200);
    expect(await User.countDocuments({ isActive: true })).toBe(1);

    // Ép tình huống chỉ còn target active (vd. dữ liệu bị sửa tay) → chặn
    const target = await createUser({ email: 'c@example.com' });
    await User.updateOne({ _id: auth.userId }, { isActive: false });
    await expect(disableUser(target._id.toString(), auth.userId)).rejects.toMatchObject({
      code: 'LAST_ACTIVE_USER',
    });
    expect(await User.countDocuments({ isActive: true })).toBe(1);
  });
});
