import { describe, expect, it } from 'vitest';
import { createTestClient } from './helpers/app';
import { setupTestDb } from './helpers/db';

describe('GET /api/v1/health', () => {
  describe('khi DB đã kết nối', () => {
    setupTestDb();

    it('trả 200 với trạng thái DB connected', async () => {
      const res = await createTestClient().get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
      expect(res.body.data.database).toEqual({ state: 'connected', connected: true });
      expect(typeof res.body.data.uptime).toBe('number');
    });
  });

  describe('khi DB chưa kết nối', () => {
    it('trả 503 theo định dạng lỗi thống nhất', async () => {
      const res = await createTestClient().get('/api/v1/health');

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(res.body.error.details.database.connected).toBe(false);
    });
  });
});
