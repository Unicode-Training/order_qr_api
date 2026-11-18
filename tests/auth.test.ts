import supertest from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { RefreshToken } from '../src/modules/auth/refreshToken.model';
import { User } from '../src/modules/users/user.model';
import { createUser, DEFAULT_PASSWORD, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

describe('Auth', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
  });

  describe('POST /api/v1/auth/login', () => {
    it('đăng nhập đúng → trả access + refresh token, không lộ passwordHash', async () => {
      await createUser({ email: 'admin@example.com' });

      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ email: '  ADMIN@Example.com ', password: DEFAULT_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.data.tokenType).toBe('Bearer');
      expect(typeof res.body.data.accessToken).toBe('string');
      expect(typeof res.body.data.refreshToken).toBe('string');
      expect(res.body.data.user).toMatchObject({ email: 'admin@example.com', isActive: true });
      expect(res.body.data.user.lastLoginAt).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);

      // Chỉ lưu hash của refresh token
      const stored = await RefreshToken.find().lean();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.tokenHash).not.toBe(res.body.data.refreshToken);
    });

    it('sai mật khẩu → 401 INVALID_CREDENTIALS', async () => {
      await createUser();
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('email không tồn tại → 401 INVALID_CREDENTIALS (cùng thông báo)', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: DEFAULT_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('thiếu dữ liệu → 400 VALIDATION_ERROR', async () => {
      const res = await supertest(app).post('/api/v1/auth/login').send({ email: 'abc' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('tài khoản bị vô hiệu hoá không đăng nhập được', async () => {
      await createUser({ isActive: false });
      const res = await supertest(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: DEFAULT_PASSWORD });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
      expect(await RefreshToken.countDocuments()).toBe(0);
    });

    it('rate limit: đăng nhập sai quá LOGIN_RATE_LIMIT_MAX lần → 429', async () => {
      await createUser();
      const client = supertest(app);
      const max = Number(process.env.LOGIN_RATE_LIMIT_MAX);
      for (let i = 0; i < max; i += 1) {
        const res = await client
          .post('/api/v1/auth/login')
          .send({ email: 'admin@example.com', password: 'wrong-password' });
        expect(res.status).toBe(401);
      }
      const blocked = await client
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: DEFAULT_PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    });

    it('đăng nhập thành công không bị tính vào rate limit', async () => {
      await createUser();
      const max = Number(process.env.LOGIN_RATE_LIMIT_MAX);
      for (let i = 0; i < max + 2; i += 1) {
        await loginAs(app);
      }
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('đổi refresh token lấy cặp token mới và thu hồi token cũ (rotation)', async () => {
      await createUser();
      const { refreshToken } = await loginAs(app);

      const res = await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(200);
      expect(res.body.data.refreshToken).not.toBe(refreshToken);

      const me = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.data.accessToken}`);
      expect(me.status).toBe(200);

      const again = await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(again.status).toBe(401);
    });

    it('dùng lại refresh token đã thu hồi → thu hồi toàn bộ phiên', async () => {
      await createUser();
      const { refreshToken } = await loginAs(app);
      const first = await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(first.status).toBe(200);

      await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);

      const next = await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first.body.data.refreshToken });
      expect(next.status).toBe(401);
    });

    it('token rác hoặc access token dùng làm refresh → 401', async () => {
      await createUser();
      const { accessToken } = await loginAs(app);

      const garbage = await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-jwt' });
      expect(garbage.status).toBe(401);

      const wrongType = await supertest(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: accessToken });
      expect(wrongType.status).toBe(401);
    });

    it('user bị vô hiệu hoá không refresh được', async () => {
      const user = await createUser();
      const { refreshToken } = await loginAs(app);
      await User.updateOne({ _id: user._id }, { isActive: false });

      const res = await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('thu hồi refresh token, sau đó refresh bị 401; gọi lại vẫn 200', async () => {
      await createUser();
      const { refreshToken } = await loginAs(app);

      const res = await supertest(app).post('/api/v1/auth/logout').send({ refreshToken });
      expect(res.status).toBe(200);

      const stored = await RefreshToken.findOne().lean();
      expect(stored?.revokedAt).toBeTruthy();

      await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
      await supertest(app).post('/api/v1/auth/logout').send({ refreshToken }).expect(200);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('trả thông tin user hiện tại', async () => {
      await createUser({ fullName: 'Chủ quán' });
      const { accessToken } = await loginAs(app);

      const res = await supertest(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ fullName: 'Chủ quán', email: 'admin@example.com' });
      expect(res.body.data.passwordHash).toBeUndefined();
    });

    it('không có token → 401', async () => {
      const res = await supertest(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/v1/auth/me/password', () => {
    it('đổi mật khẩu: mật khẩu cũ hết hiệu lực, phiên cũ bị thu hồi', async () => {
      await createUser();
      const { accessToken, refreshToken } = await loginAs(app);

      const res = await supertest(app)
        .patch('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'NewPassword@456' });
      expect(res.status).toBe(200);
      expect(typeof res.body.data.refreshToken).toBe('string');

      await supertest(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
      await supertest(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: DEFAULT_PASSWORD })
        .expect(401);
      await loginAs(app, 'admin@example.com', 'NewPassword@456');
    });

    it('sai mật khẩu hiện tại → 400', async () => {
      await createUser();
      const { accessToken } = await loginAs(app);
      const res = await supertest(app)
        .patch('/api/v1/auth/me/password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'wrong-password', newPassword: 'NewPassword@456' });
      expect(res.status).toBe(400);
    });
  });
});
