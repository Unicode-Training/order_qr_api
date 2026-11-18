import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { swaggerSpec } from '../src/config/swagger';
import { OPENAPI_OUTPUT, serializeSpec } from '../src/scripts/export-openapi';
import supertest from 'supertest';
import { createApp } from '../src/app';
import { createTestClient } from './helpers/app';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';

setupTestDb();

type Operation = {
  summary?: string;
  security?: Record<string, unknown>[];
  responses?: Record<string, { content?: unknown; $ref?: string }>;
};
const spec = swaggerSpec as {
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => METHODS.includes(method))
    .map(([method, op]) => ({ path, method, op })),
);

describe('OpenAPI spec', () => {
  it('có đủ security scheme Bearer và X-Session-Token', () => {
    expect(spec.components.securitySchemes).toMatchObject({
      bearerAuth: { type: 'http', scheme: 'bearer' },
      sessionToken: { type: 'apiKey', in: 'header', name: 'X-Session-Token' },
    });
  });

  it('mọi endpoint có summary, response 2xx có schema (trừ file nhị phân)', () => {
    expect(operations.length).toBeGreaterThanOrEqual(79);
    for (const { path, method, op } of operations) {
      const label = `${method.toUpperCase()} ${path}`;
      expect(op.summary, label).toBeTruthy();
      const success = Object.entries(op.responses ?? {}).filter(([code]) => code.startsWith('2'));
      expect(success.length, label).toBeGreaterThan(0);
      for (const [, response] of success) {
        expect(response.content ?? response.$ref, label).toBeTruthy();
      }
    }
  });

  it('/admin/* yêu cầu Bearer + có 401; route khách sau QR dùng X-Session-Token', () => {
    for (const { path, method, op } of operations) {
      const label = `${method.toUpperCase()} ${path}`;
      if (path.startsWith('/admin/')) {
        expect(op.security, label).toEqual([{ bearerAuth: [] }]);
        expect(op.responses?.['401'], label).toBeDefined();
      }
      if (path.startsWith('/public/sessions/current') || path.startsWith('/public/orders')) {
        expect(op.security, label).toEqual([{ sessionToken: [] }]);
        expect(op.responses?.['401'], label).toBeDefined();
      }
      if (path.startsWith('/public/')) {
        expect(op.responses?.['429'], label).toBeDefined();
      }
    }
  });

  it('mọi $ref đều trỏ tới component tồn tại', () => {
    const json = JSON.stringify(spec);
    const refs = new Set(
      [...json.matchAll(/"\$ref":"#\/components\/(\w+)\/([\w-]+)"/g)].map((m) => `${m[1]}/${m[2]}`),
    );
    const components = spec.components as unknown as Record<string, Record<string, unknown>>;
    for (const ref of refs) {
      const [group, name] = ref.split('/') as [string, string];
      expect(components[group]?.[name], ref).toBeDefined();
    }
  });

  it('mọi path trong spec đều là route thật đã đăng ký', async () => {
    const app = createApp();
    await createUser();
    const { accessToken } = await loginAs(app);
    const sample = (path: string) =>
      path.replace(/\{(\w+)\}/g, (_m, name: string) =>
        name === 'qrToken'
          ? 'x'.repeat(32)
          : name === 'publicId'
            ? 'abc'
            : '665f1c2e8b3a4d0012345678',
      );
    for (const { path, method } of operations) {
      const res = await supertest(app)
        [method as 'get'](`/api/v1${sample(path)}`)
        .set('Authorization', `Bearer ${accessToken}`);
      // Route tồn tại → có thể 400/404 nghiệp vụ, nhưng không phải lỗi "Không tìm thấy route".
      const message: string = res.body?.error?.message ?? '';
      expect(message.startsWith('Không tìm thấy route'), `${method.toUpperCase()} ${path}`).toBe(
        false,
      );
    }
  });

  it('docs/openapi.json khớp với code (chạy `npm run docs:openapi` khi đổi route)', () => {
    expect(readFileSync(OPENAPI_OUTPUT, 'utf8')).toBe(serializeSpec(swaggerSpec));
  });

  it('GET /api/docs.json trả spec', async () => {
    const res = await createTestClient().get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
  });
});
