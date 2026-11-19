import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Tạo file gom vi phạm cho responseContract.ts và in báo cáo khi bộ test chạy xong. */
export default function setup(): () => void {
  const output = path.join(tmpdir(), `order-qr-openapi-contract-${process.pid}.jsonl`);
  rmSync(output, { force: true });
  process.env.OPENAPI_CONTRACT_OUT = output;

  return () => {
    const lines = existsSync(output) ? readFileSync(output, 'utf8').trim().split('\n') : [];
    rmSync(output, { force: true });
    const counts = new Map<string, number>();
    for (const line of lines.filter(Boolean)) {
      const { endpoint, issue } = JSON.parse(line) as { endpoint: string; issue: string };
      const key = `${endpoint} — ${issue}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size === 0) {
      console.log('\n✔ Mọi response trong bộ test đều khớp tài liệu OpenAPI\n');
      return;
    }
    console.error(`\n✘ ${counts.size} điểm lệch giữa response thật và tài liệu OpenAPI:`);
    for (const [key, count] of [...counts].sort()) console.error(`  - ${key} (×${count})`);
    console.error('');
    process.exitCode = 1;
  };
}
