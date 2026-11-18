// Biến môi trường mặc định cho test (chạy trước khi import src/config/env).
// DATABASE_URL chỉ là placeholder — test thật dùng mongodb-memory-server qua tests/helpers/db.ts.
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '0',
  DATABASE_URL: 'mongodb://127.0.0.1:27017/order-qr-test',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef012',
  JWT_ACCESS_EXPIRES: '15m',
  JWT_REFRESH_EXPIRES: '7d',
  BCRYPT_SALT_ROUNDS: '4',
  LOGIN_RATE_LIMIT_MAX: '5',
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: '15',
  CLIENT_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000',
};

process.env.NODE_ENV = 'test';
for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
