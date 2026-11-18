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
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  // Rate limit cho các route /public (khách không đăng nhập). Khách cùng nhà hàng thường dùng chung
  // một IP (Wi-Fi quán) nên giới hạn chung theo IP đặt rộng; thao tác ghi bị giới hạn chặt hơn.
  PUBLIC_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  /** Số request tối đa / IP / cửa sổ cho mọi route /public. */
  PUBLIC_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
  /** Số thao tác ghi tối đa / cửa sổ: mở phiên (theo IP), quote/đặt/huỷ đơn (theo phiên bàn). */
  PUBLIC_WRITE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
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
  // Cloudinary (lưu ảnh món/danh mục/nhà hàng). Để trống → API upload trả 503.
  CLOUDINARY_CLOUD_NAME: z.string().trim().default(''),
  CLOUDINARY_API_KEY: z.string().trim().default(''),
  CLOUDINARY_API_SECRET: z.string().trim().default(''),
  /** Thư mục gốc trên Cloudinary; ảnh được lưu vào `<CLOUDINARY_FOLDER>/<subfolder>`. */
  CLOUDINARY_FOLDER: z
    .string()
    .trim()
    .default('')
    .transform((value) => value.replace(/^\/+|\/+$/g, '') || 'order-qr')
    .pipe(z.string().regex(/^[A-Za-z0-9_\-/]+$/, 'CLOUDINARY_FOLDER chỉ gồm chữ, số, _, -, /')),
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
