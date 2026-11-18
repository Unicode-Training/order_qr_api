/**
 * Xuất tài liệu OpenAPI ra file JSON (mặc định docs/openapi.json) để frontend sinh client / import Postman.
 *   npm run docs:openapi            # ghi file
 *   npm run docs:openapi -- --check # chỉ kiểm tra file có khớp code không (exit 1 nếu lệch)
 * Không cần kết nối DB; spec được sinh từ comment @openapi trong các file *.routes.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const OPENAPI_OUTPUT = path.resolve(__dirname, '../../docs/openapi.json');

/** Chuỗi JSON ổn định (thụt 2 dấu cách, xuống dòng cuối file) để diff gọn trong git. */
export function serializeSpec(spec: unknown): string {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

async function main(): Promise<void> {
  // Spec không phụ thuộc biến môi trường, nhưng import config/env yêu cầu có đủ biến bắt buộc.
  process.env.DATABASE_URL ||= 'mongodb://127.0.0.1:27017/openapi-export';
  process.env.JWT_ACCESS_SECRET ||= 'openapi-export-placeholder-secret-000000';
  process.env.JWT_REFRESH_SECRET ||= 'openapi-export-placeholder-secret-111111';
  process.env.CLIENT_URL ||= 'http://localhost:3000';
  const { swaggerSpec } = await import('../config/swagger.js');
  const content = serializeSpec(swaggerSpec);

  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OPENAPI_OUTPUT, 'utf8');
    } catch {
      // chưa có file
    }
    if (current !== content) {
      console.error(`${OPENAPI_OUTPUT} chưa cập nhật — chạy: npm run docs:openapi`);
      process.exit(1);
    }
    console.log('docs/openapi.json đã khớp với code');
    return;
  }

  mkdirSync(path.dirname(OPENAPI_OUTPUT), { recursive: true });
  writeFileSync(OPENAPI_OUTPUT, content);
  const spec = swaggerSpec as { paths?: Record<string, object> };
  const operations = Object.values(spec.paths ?? {}).reduce(
    (count, item) => count + Object.keys(item).filter((key) => key !== 'parameters').length,
    0,
  );
  console.log(`Đã ghi ${path.relative(process.cwd(), OPENAPI_OUTPUT)} (${operations} endpoint)`);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
