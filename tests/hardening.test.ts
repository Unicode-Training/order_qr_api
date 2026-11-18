import { EventEmitter } from 'node:events';
import type { Server } from 'node:http';
import supertest from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildCorsOptions, createApp } from '../src/app';
import { env } from '../src/config/env';
import { sanitizeValue } from '../src/middlewares/sanitize';
import { User } from '../src/modules/users/user.model';
import { createShutdownHandler } from '../src/utils/gracefulShutdown';
import { createUser, DEFAULT_PASSWORD, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

describe('sanitizeValue', () => {
  it('loại bỏ key bắt đầu bằng $ hoặc chứa dấu chấm, ở mọi cấp', () => {
    const input = {
      email: { $ne: null },
      name: 'An',
      'profile.role': 'x',
      nested: [{ ok: 1, $where: 'sleep(1000)' }],
      __proto__: { polluted: true },
    };
    const { value, removed } = sanitizeValue(input);
    expect(value).toEqual({ email: {}, name: 'An', nested: [{ ok: 1 }] });
    expect(removed).toBe(3);
    // Không sửa object gốc
    expect(input.email).toEqual({ $ne: null });
  });

  it('giữ nguyên giá trị nguyên thuỷ / dữ liệu sạch', () => {
    expect(sanitizeValue('$abc').value).toBe('$abc');
    expect(sanitizeValue({ a: [1, 'b'] })).toEqual({ value: { a: [1, 'b'] }, removed: 0 });
  });
});

describe('Hardening HTTP', () => {
  it('chặn NoSQL injection khi đăng nhập', async () => {
    const app = createApp();
    await createUser({ email: 'victim@example.com' });
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    // Đăng nhập hợp lệ vẫn hoạt động
    await expect(loginAs(app, 'victim@example.com', DEFAULT_PASSWORD)).resolves.toBeTruthy();
  });

  it('query chứa toán tử Mongo bị loại bỏ, không lọc lộ dữ liệu', async () => {
    const app = createApp();
    await createUser();
    await User.create({ fullName: 'Khác', email: 'khac@example.com', passwordHash: 'x' });
    const { accessToken } = await loginAs(app);
    const res = await supertest(app)
      .get('/api/v1/admin/users?search[$regex]=.*&isActive[$ne]=false')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBeLessThan(500);
  });

  it('body JSON quá 100kb → 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await supertest(createApp())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(150 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('helmet: header bảo mật, cho phép nhúng ảnh QR cross-origin', async () => {
    const res = await supertest(createApp()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS theo CORS_ORIGINS: origin hợp lệ được phép, origin lạ không có header', async () => {
    const app = createApp();
    const ok = await supertest(app)
      .options('/api/v1/public/menu')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'X-Session-Token');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(ok.headers['access-control-allow-headers']).toContain('X-Session-Token');

    const bad = await supertest(app).get('/api/v1/health').set('Origin', 'https://evil.example');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('buildCorsOptions: "*" hoặc rỗng → cho phép mọi origin; bỏ dấu / cuối', () => {
    expect(buildCorsOptions(['*']).origin).toBe(true);
    expect(buildCorsOptions([]).origin).toBe(true);
    const origin = buildCorsOptions(['https://app.example/']).origin as (
      o: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => void;
    const check = (value: string | undefined) =>
      new Promise((resolve) => origin(value, (_e, allow) => resolve(allow)));
    return Promise.all([
      expect(check('https://app.example')).resolves.toBe(true),
      expect(check('https://other.example')).resolves.toBe(false),
      expect(check(undefined)).resolves.toBe(true),
    ]);
  });

  it('rate limit route /public trả 429 kèm header RateLimit', async () => {
    const previous = env.PUBLIC_RATE_LIMIT_MAX;
    env.PUBLIC_RATE_LIMIT_MAX = 3; // limiter đọc cấu hình khi tạo app
    try {
      const app = createApp();
      for (let i = 0; i < 3; i += 1) {
        expect((await supertest(app).get('/api/v1/public/restaurant')).status).toBe(200);
      }
      const limited = await supertest(app).get('/api/v1/public/restaurant');
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(limited.headers['retry-after']).toBeDefined();
      expect(limited.headers.ratelimit).toBeDefined();
    } finally {
      env.PUBLIC_RATE_LIMIT_MAX = previous;
    }
  });
});

describe('Graceful shutdown', () => {
  function fakeServer() {
    const emitter = new EventEmitter() as EventEmitter & Partial<Server>;
    let closeCallback: ((err?: Error) => void) | undefined;
    const server = Object.assign(emitter, {
      close: vi.fn((cb: (err?: Error) => void) => {
        closeCallback = cb;
        return server;
      }),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    });
    return { server: server as unknown as Server, finishClose: () => closeCallback?.() };
  }

  it('đóng server → dọn dẹp DB → thoát 0; tín hiệu lặp lại bị bỏ qua', async () => {
    const { server, finishClose } = fakeServer();
    const onClose = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    const shutdown = createShutdownHandler({ server, onClose, exit, timeoutMs: 1000 });

    shutdown('SIGTERM');
    shutdown('SIGINT');
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeIdleConnections).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled(); // còn request đang chạy

    finishClose();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('quá thời gian chờ → đóng mọi kết nối, thoát 1', async () => {
    vi.useFakeTimers();
    try {
      const { server } = fakeServer();
      const exit = vi.fn();
      const shutdown = createShutdownHandler({
        server,
        onClose: vi.fn().mockResolvedValue(undefined),
        exit,
        timeoutMs: 500,
      });
      shutdown('SIGTERM');
      vi.advanceTimersByTime(600);
      expect(server.closeAllConnections).toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dọn dẹp lỗi → thoát 1', async () => {
    const { server, finishClose } = fakeServer();
    const exit = vi.fn();
    const shutdown = createShutdownHandler({
      server,
      onClose: vi.fn().mockRejectedValue(new Error('db')),
      exit,
    });
    shutdown('unhandledRejection', 1);
    finishClose();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
