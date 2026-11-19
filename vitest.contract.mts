import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.mts';

/**
 * `npm run docs:contract`: chạy toàn bộ test, đối chiếu mọi response JSON với docs OpenAPI
 * (xem tests/contract/responseContract.ts). Thoát mã 1 nếu có điểm lệch.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      globalSetup: ['tests/contract/globalSetup.ts'],
      setupFiles: ['tests/contract/responseContract.ts'],
    },
  }),
);
