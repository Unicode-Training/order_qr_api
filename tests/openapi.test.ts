import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { swaggerSpec } from '../src/config/swagger';
import { OPENAPI_OUTPUT, serializeSpec } from '../src/scripts/export-openapi';
import supertest from 'supertest';
import { z, type ZodType } from 'zod';
import { createApp } from '../src/app';
import { createApiRouter } from '../src/routes';
import { createTestClient } from './helpers/app';
import { createUser, loginAs } from './helpers/auth';
import { setupTestDb } from './helpers/db';
import { listRoutes } from './helpers/routes';

setupTestDb();

type Schema = {
  $ref?: string;
  properties?: Record<string, unknown>;
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
};
type Parameter = { in: string; name: string; $ref?: string };
type Operation = {
  summary?: string;
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
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

/** Giải `$ref` nội bộ (`#/components/...`). */
function deref<T extends { $ref?: string }>(node: T): T {
  if (!node.$ref) return node;
  const target = node.$ref
    .split('/')
    .slice(1)
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], spec);
  return deref(target as T);
}

/** Tên các field cấp 1 mà schema mô tả (gộp allOf/anyOf/oneOf). */
function schemaKeys(schema: Schema | undefined): Set<string> {
  const keys = new Set<string>();
  if (!schema) return keys;
  const node = deref(schema);
  for (const key of Object.keys(node.properties ?? {})) keys.add(key);
  for (const sub of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) {
    for (const key of schemaKeys(sub)) keys.add(key);
  }
  return keys;
}

/** Tên các field mà schema zod nhận (đầu vào). */
function zodKeys(schema: ZodType): Set<string> {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Schema;
  return schemaKeys(json);
}

const sorted = (keys: Set<string>) => [...keys].sort();

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

  it('mọi route đã đăng ký đều có tài liệu (và ngược lại)', () => {
    const registered = listRoutes(createApiRouter()).map(
      ({ method, path }) => `${method.toUpperCase()} ${path}`,
    );
    const documented = operations.map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(new Set(registered).size).toBe(registered.length);
    expect(registered.sort()).toEqual(documented.sort());
  });

  it('tham số path/query và field body trong tài liệu khớp schema zod của route', () => {
    for (const route of listRoutes(createApiRouter())) {
      const label = `${route.method.toUpperCase()} ${route.path}`;
      const item = spec.paths[route.path]!;
      const op = item[route.method]!;
      const params = [
        ...((item.parameters as Parameter[] | undefined) ?? []),
        ...(op.parameters ?? []),
      ].map(deref);
      const documentedParams = (location: string) =>
        new Set(params.filter((param) => param.in === location).map((param) => param.name));

      if (Object.keys(route.schemas).length > 0) {
        expect(op.responses?.['400'], `${label} thiếu response 400`).toBeDefined();
      }
      if (route.schemas.params) {
        expect(sorted(documentedParams('path')), `${label} (path)`).toEqual(
          sorted(zodKeys(route.schemas.params)),
        );
      }
      if (route.schemas.query) {
        expect(sorted(documentedParams('query')), `${label} (query)`).toEqual(
          sorted(zodKeys(route.schemas.query)),
        );
      }
      if (route.schemas.body) {
        const bodyKeys = zodKeys(route.schemas.body);
        // Schema dạng record (vd. PATCH /admin/settings) không liệt kê field → bỏ qua.
        if (bodyKeys.size === 0) continue;
        const bodySchema = op.requestBody?.content?.['application/json']?.schema;
        expect(sorted(schemaKeys(bodySchema)), `${label} (body)`).toEqual(sorted(bodyKeys));
      }
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
