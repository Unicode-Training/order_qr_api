import type { NextFunction, Request, Response } from 'express';

/**
 * Chống NoSQL injection: loại bỏ mọi key bắt đầu bằng `$` hoặc chứa `.` (vd. `{"email": {"$ne": null}}`,
 * `?status[$gt]=`) khỏi req.body / req.query / req.params trước khi tới validate + service.
 *
 * Tự viết thay cho `express-mongo-sanitize` vì thư viện đó gán lại `req.query` — không chạy với Express 5
 * (req.query là getter). Ngoài lớp này: zod validate mọi input, `mongoose.set('strictQuery', true)`
 * bỏ field lạ trong filter.
 */
const MAX_DEPTH = 20;

function isUnsafeKey(key: string): boolean {
  return key.startsWith('$') || key.includes('.');
}

/** Trả về bản sạch của `value` và số key bị loại bỏ (không sửa object gốc). */
export function sanitizeValue(value: unknown, depth = 0): { value: unknown; removed: number } {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') {
    return { value, removed: 0 };
  }
  if (Buffer.isBuffer(value) || value instanceof Date) return { value, removed: 0 };

  let removed = 0;
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      const result = sanitizeValue(item, depth + 1);
      removed += result.removed;
      return result.value;
    });
    return { value: items, removed };
  }

  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isUnsafeKey(key) || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      removed += 1;
      continue;
    }
    const result = sanitizeValue(child, depth + 1);
    removed += result.removed;
    clean[key] = result.value;
  }
  return { value: clean, removed };
}

export function sanitizeRequest(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    const result = sanitizeValue(req.body);
    if (result.removed > 0) req.body = result.value;
  }
  const query = sanitizeValue(req.query);
  if (query.removed > 0) {
    // Express 5: req.query là getter → ghi đè bằng defineProperty (giống middleware validate).
    Object.defineProperty(req, 'query', {
      value: query.value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  next();
}
