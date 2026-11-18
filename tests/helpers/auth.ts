import type { Express } from 'express';
import supertest from 'supertest';
import { User } from '../../src/modules/users/user.model';
import { hashPassword } from '../../src/utils/password';

export const DEFAULT_PASSWORD = 'Password@123';

export async function createUser(
  overrides: { email?: string; fullName?: string; password?: string; isActive?: boolean } = {},
) {
  return User.create({
    fullName: overrides.fullName ?? 'Nhân viên Test',
    email: overrides.email ?? 'admin@example.com',
    passwordHash: await hashPassword(overrides.password ?? DEFAULT_PASSWORD),
    isActive: overrides.isActive ?? true,
  });
}

/** Tạo user (nếu cần) và đăng nhập, trả về token + id. */
export async function loginAs(
  app: Express,
  email = 'admin@example.com',
  password = DEFAULT_PASSWORD,
): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const res = await supertest(app).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`Login thất bại: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    accessToken: res.body.data.accessToken,
    refreshToken: res.body.data.refreshToken,
    userId: res.body.data.user.id,
  };
}
