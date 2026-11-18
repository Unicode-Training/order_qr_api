import morgan from 'morgan';
import { isProduction, isTest } from '../config/env';

/** HTTP access log. Tắt khi chạy test để output gọn. */
export const requestLogger = morgan(isProduction ? 'combined' : 'dev', {
  skip: () => isTest,
});
