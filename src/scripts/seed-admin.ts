import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { emailSchema, passwordSchema } from '../modules/auth/auth.schema';
import { toPublicUser, User, type PublicUser } from '../modules/users/user.model';
import { logger } from '../utils/logger';
import { hashPassword } from '../utils/password';

const seedEnvSchema = z.object({
  SEED_ADMIN_EMAIL: emailSchema,
  SEED_ADMIN_PASSWORD: passwordSchema,
  SEED_ADMIN_FULLNAME: z.string().trim().min(1).max(100).default('Quản trị viên'),
});

export type SeedAdminResult = { created: boolean; user: PublicUser };

export type SeedAdminInput = z.infer<typeof seedEnvSchema>;

/** Đọc + validate biến môi trường seed. Ném lỗi liệt kê các biến thiếu/sai. */
export function parseSeedEnv(source: NodeJS.ProcessEnv = process.env): SeedAdminInput {
  const parsed = seedEnvSchema.safeParse({
    SEED_ADMIN_EMAIL: source.SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: source.SEED_ADMIN_PASSWORD,
    SEED_ADMIN_FULLNAME: source.SEED_ADMIN_FULLNAME || undefined,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Thiếu hoặc sai biến môi trường seed:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Tạo tài khoản đầu tiên từ SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
 * Idempotent: nếu email đã tồn tại thì bỏ qua (KHÔNG ghi đè mật khẩu).
 */
export async function seedAdmin(source: NodeJS.ProcessEnv = process.env): Promise<SeedAdminResult> {
  const {
    SEED_ADMIN_EMAIL: email,
    SEED_ADMIN_PASSWORD: password,
    SEED_ADMIN_FULLNAME: fullName,
  } = parseSeedEnv(source);

  const existing = await User.findOne({ email });
  if (existing) return { created: false, user: toPublicUser(existing) };

  const user = await User.create({ fullName, email, passwordHash: await hashPassword(password) });
  return { created: true, user: toPublicUser(user) };
}

async function main(): Promise<void> {
  parseSeedEnv(); // báo lỗi cấu hình ngay, trước khi kết nối DB
  await connectDatabase();
  try {
    const { created, user } = await seedAdmin();
    if (created) logger.info(`Đã tạo tài khoản ${user.email}`);
    else logger.warn(`Tài khoản ${user.email} đã tồn tại — bỏ qua (không đổi mật khẩu)`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    logger.error(
      err instanceof Error ? err.message : 'Seed thất bại',
      err instanceof Error ? undefined : err,
    );
    process.exit(1);
  });
}
