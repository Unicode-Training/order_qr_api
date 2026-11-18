import { describe, expect, it } from 'vitest';
import { User } from '../src/modules/users/user.model';
import { seedAdmin } from '../src/scripts/seed-admin';
import { verifyPassword } from '../src/utils/password';
import { setupTestDb } from './helpers/db';

setupTestDb();

describe('seed:admin', () => {
  const env = {
    SEED_ADMIN_EMAIL: 'Owner@Example.com',
    SEED_ADMIN_PASSWORD: 'Owner@12345',
  } as NodeJS.ProcessEnv;

  it('tạo tài khoản đầu tiên với mật khẩu đã băm', async () => {
    const result = await seedAdmin(env);
    expect(result.created).toBe(true);
    expect(result.user).toMatchObject({ email: 'owner@example.com', isActive: true });

    const user = await User.findOne({ email: 'owner@example.com' }).select('+passwordHash');
    expect(user?.passwordHash).not.toBe('Owner@12345');
    expect(await verifyPassword('Owner@12345', user!.passwordHash)).toBe(true);
  });

  it('idempotent: chạy lại không tạo trùng và không đổi mật khẩu', async () => {
    await seedAdmin(env);
    const again = await seedAdmin({ ...env, SEED_ADMIN_PASSWORD: 'Another@12345' });
    expect(again.created).toBe(false);
    expect(await User.countDocuments()).toBe(1);
    const user = await User.findOne().select('+passwordHash');
    expect(await verifyPassword('Owner@12345', user!.passwordHash)).toBe(true);
  });

  it('thiếu biến môi trường → lỗi rõ ràng', async () => {
    await expect(seedAdmin({} as NodeJS.ProcessEnv)).rejects.toThrow(/SEED_ADMIN_EMAIL/);
  });
});
