import type { QueryFilter } from 'mongoose';
import { AppError } from '../../utils/AppError';
import {
  buildPaginationMeta,
  getPaginationOptions,
  type PaginationMeta,
} from '../../utils/pagination';
import { hashPassword } from '../../utils/password';
import { revokeAllUserTokens } from '../auth/token.service';
import { toPublicUser, User, type IUser, type PublicUser } from './user.model';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.schema';

const SORT_FIELDS = ['createdAt', 'updatedAt', 'fullName', 'email', 'lastLoginAt'] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function listUsers(
  query: ListUsersQuery,
): Promise<{ items: PublicUser[]; meta: PaginationMeta }> {
  const { page, limit, skip, sort } = getPaginationOptions(query, {
    allowedSortFields: SORT_FIELDS,
  });

  const filter: QueryFilter<IUser> = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ fullName: pattern }, { email: pattern }];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  return { items: users.map(toPublicUser), meta: buildPaginationMeta(total, page, limit) };
}

async function findUserOrThrow(id: string) {
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('Không tìm thấy tài khoản');
  return user;
}

async function assertEmailAvailable(email: string, excludeId?: string): Promise<void> {
  const existing = await User.exists({ email, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
  if (existing) throw AppError.conflict('Email đã được sử dụng', { email });
}

export async function getUser(id: string): Promise<PublicUser> {
  return toPublicUser(await findUserOrThrow(id));
}

export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  await assertEmailAvailable(input.email);
  const user = await User.create({
    fullName: input.fullName,
    email: input.email,
    passwordHash: await hashPassword(input.password),
  });
  return toPublicUser(user);
}

/** Kiểm tra quy tắc vô hiệu hoá: không tự khoá mình, luôn còn ít nhất một tài khoản active. */
async function assertCanDeactivate(targetId: string, actorId: string): Promise<void> {
  if (targetId === actorId) {
    throw new AppError(
      400,
      'CANNOT_DISABLE_SELF',
      'Không thể tự vô hiệu hoá tài khoản của chính mình',
    );
  }
  const otherActive = await User.countDocuments({ _id: { $ne: targetId }, isActive: true });
  if (otherActive === 0) {
    throw new AppError(
      400,
      'LAST_ACTIVE_USER',
      'Phải luôn còn ít nhất một tài khoản đang hoạt động',
    );
  }
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
  actorId: string,
): Promise<PublicUser> {
  const user = await findUserOrThrow(id);
  const deactivating = input.isActive === false && user.isActive;

  if (deactivating) await assertCanDeactivate(id, actorId);
  if (input.email !== undefined && input.email !== user.email) {
    await assertEmailAvailable(input.email, id);
    user.email = input.email;
  }
  if (input.fullName !== undefined) user.fullName = input.fullName;
  if (input.isActive !== undefined) user.isActive = input.isActive;
  if (input.password !== undefined) user.passwordHash = await hashPassword(input.password);

  await user.save();
  if (deactivating || input.password !== undefined) await revokeAllUserTokens(user._id);
  return toPublicUser(user);
}

/** DELETE = vô hiệu hoá mềm (isActive = false), không xoá dữ liệu. Idempotent. */
export async function disableUser(id: string, actorId: string): Promise<PublicUser> {
  return updateUser(id, { isActive: false }, actorId);
}
