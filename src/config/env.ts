import 'dotenv/config';
import { z } from 'zod';

const durationSchema = z
  .string()
  .trim()
  .regex(/^\d+(ms|s|m|h|d|w|y)?$/, 'Định dạng thời hạn không hợp lệ (ví dụ: 15m, 1h, 7d)');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  DATABASE_URL: z
    .string()
    .trim()
    .min(1, 'DATABASE_URL là bắt buộc')
    .regex(
      /^mongodb(\+srv)?:\/\//,
      'DATABASE_URL phải bắt đầu bằng mongodb:// hoặc mongodb+srv://',
    ),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET phải có ít nhất 32 ký tự'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET phải có ít nhất 32 ký tự'),
  JWT_ACCESS_EXPIRES: durationSchema.default('15m'),
  JWT_REFRESH_EXPIRES: durationSchema.default('7d'),
  CLIENT_URL: z.url('CLIENT_URL phải là URL hợp lệ'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Cấu hình môi trường không hợp lệ (.env):\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
