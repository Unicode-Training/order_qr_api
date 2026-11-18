import { describe, expect, it } from 'vitest';
import { createTestClient } from './helpers/app';

describe('404 handler', () => {
  it('trả 404 JSON thống nhất cho route không tồn tại', async () => {
    const res = await createTestClient().get('/api/v1/khong-ton-tai');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Không tìm thấy route GET /api/v1/khong-ton-tai',
      },
    });
  });

  it('trả 400 khi body JSON sai cú pháp', async () => {
    const res = await createTestClient()
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"invalid":');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });
});
