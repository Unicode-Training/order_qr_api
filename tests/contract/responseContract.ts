/**
 * Setup file cho `npm run docs:contract`: bọc `res.json` của Express để đối chiếu MỌI response
 * mà bộ test sinh ra với tài liệu OpenAPI:
 * - mã HTTP phải được khai báo trong `responses` của endpoint;
 * - response 2xx phải khớp schema (kiểu dữ liệu, enum, required, nullable — dùng ajv);
 * - response 2xx không được có field chưa mô tả trong schema.
 * Vi phạm được ghi (JSONL) vào file `OPENAPI_CONTRACT_OUT`; `globalSetup.ts` tổng hợp khi chạy xong.
 * Không ảnh hưởng `npm test` (chỉ nạp qua vitest.contract.mts).
 */
import { appendFileSync } from 'node:fs';
import Ajv, { type ValidateFunction } from 'ajv';
import express from 'express';
import { swaggerSpec } from '../../src/config/swagger';

type Schema = {
  $ref?: string;
  type?: string;
  nullable?: boolean;
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  allOf?: Schema[];
};
type Response = { $ref?: string; content?: Record<string, { schema?: Schema }> };
type Operation = { responses?: Record<string, Response> };
type Spec = { paths: Record<string, Record<string, Operation>>; components: unknown };

const OUTPUT = process.env.OPENAPI_CONTRACT_OUT;
const spec = JSON.parse(JSON.stringify(swaggerSpec)) as Spec;

/** OpenAPI 3.0 → JSON Schema cho ajv: `nullable` → anyOf null, `$ref` trỏ vào schema "spec". */
function toJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toJsonSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'example' || key === 'nullable') continue;
    out[key] = key === '$ref' && typeof value === 'string' ? `spec${value}` : toJsonSchema(value);
  }
  return (node as Schema).nullable ? { anyOf: [out, { type: 'null' }] } : out;
}

const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
ajv.addSchema({ components: toJsonSchema(spec.components) }, 'spec');
const validators = new Map<Schema, ValidateFunction>();

function deref<T extends { $ref?: string }>(node: T): T {
  if (!node.$ref) return node;
  const target = node.$ref
    .split('/')
    .slice(1)
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)[key], spec);
  return deref(target as T);
}

/** Field có trong dữ liệu nhưng không được mô tả bởi bất kỳ schema nào trong `schemas` (gộp allOf). */
function findUndocumented(schemas: Schema[], data: unknown, at: string, out: string[]): void {
  if (data === null || typeof data !== 'object') return;
  const parts: Schema[] = [];
  const collect = (schema: Schema) => {
    const node = deref(schema);
    parts.push(node);
    node.allOf?.forEach(collect);
  };
  schemas.forEach(collect);
  if (Array.isArray(data)) {
    const items = parts.flatMap((part) => (part.items ? [part.items] : []));
    if (items.length) data.forEach((value) => findUndocumented(items, value, `${at}[]`, out));
    return;
  }
  const withProps = parts.filter((part) => part.properties);
  if (withProps.length === 0 || parts.some((part) => part.additionalProperties)) return;
  for (const [key, value] of Object.entries(data)) {
    const defs = withProps.flatMap((part) =>
      part.properties?.[key] ? [part.properties[key]] : [],
    );
    if (defs.length === 0) out.push(`${at}.${key}`);
    else findUndocumented(defs, value, `${at}.${key}`, out);
  }
}

const routes = Object.keys(spec.paths)
  .map((path) => ({
    path,
    regex: new RegExp(`^/api/v1${path.replace(/\{\w+\}/g, '[^/]+')}$`),
    params: (path.match(/\{/g) ?? []).length,
  }))
  // Path tĩnh (vd. /admin/tables/stats) được ưu tiên hơn path có tham số (/admin/tables/{id}).
  .sort((a, b) => a.params - b.params);

function check(op: Operation, status: number, body: unknown): string[] {
  const response = op.responses?.[String(status)];
  if (!response) {
    const code = (body as { error?: { code?: string } } | null)?.error?.code ?? '';
    return [`mã ${status} (${code}) chưa khai báo trong responses`];
  }
  const schema = deref(response).content?.['application/json']?.schema;
  if (!schema || status >= 300) return [];
  let validate = validators.get(schema);
  if (!validate) {
    validate = ajv.compile(toJsonSchema(schema) as object);
    validators.set(schema, validate);
  }
  const issues: string[] = [];
  if (!validate(body)) {
    for (const error of validate.errors ?? []) {
      issues.push(
        `sai kiểu ${error.instancePath.replace(/\/\d+(?=\/|$)/g, '/[]')} ${error.message}`,
      );
    }
  }
  const extra: string[] = [];
  findUndocumented([schema], body, '', extra);
  issues.push(...extra.map((field) => `field chưa mô tả ${field}`));
  return issues;
}

if (OUTPUT) {
  const originalJson = express.response.json;
  express.response.json = function json(this: express.Response, body?: unknown) {
    const url = this.req.originalUrl.split('?')[0] ?? '';
    const method = this.req.method.toLowerCase();
    const route = routes.find(({ regex }) => regex.test(url));
    // Route không có trong docs (vd. test 404 cố ý) do tests/openapi.test.ts kiểm tra riêng.
    const op = route && spec.paths[route.path]?.[method];
    if (route && op) {
      // Serialize như khi gửi đi (Date → chuỗi ISO, ObjectId → chuỗi).
      const sent: unknown = JSON.parse(JSON.stringify(body ?? null));
      for (const issue of check(op, this.statusCode, sent)) {
        const line = { endpoint: `${method.toUpperCase()} ${route.path}`, issue };
        appendFileSync(OUTPUT, `${JSON.stringify(line)}\n`);
      }
    }
    return originalJson.call(this, body);
  };
}
