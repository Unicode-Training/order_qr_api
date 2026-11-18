import { AppError } from '../../utils/AppError';
import { hashPassword, verifyPassword } from '../../utils/password';
import { toPublicUser, User, type PublicUser } from '../users/user.model';
import type { ChangePasswordInput, LoginInput } from './auth.schema';
import { RefreshToken } from './refreshToken.model';
import {
  hashToken,
  issueTokenPair,
  revokeAllUserTokens,
  verifyToken,
  type TokenPair,
} from './token.service';

export interface AuthResult extends TokenPair {
  user: PublicUser;
}

// Hash giả (cùng số vòng bcrypt) để so sánh khi email không tồn tại — giữ thời gian phản hồi
// tương đương, tránh dò email qua thời gian xử lý. Tạo lười ở lần dùng đầu tiên.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('dummy-password-for-timing'));

const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng');

export async function login({ email, password }: LoginInput): Promise<AuthResult> {
  const user = await User.findOne({ email }).select('+passwordHash');
  if (!user) {
    await verifyPassword(password, await getDummyHash());
    throw invalidCredentials();
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    throw invalidCredentials();
  }
  if (!user.isActive) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'Tài khoản đã bị vô hiệu hoá');
  }

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokenPair(user._id);
  return { ...tokens, user: toPublicUser(user) };
}

/**
 * Đổi refresh token lấy cặp token mới (rotation): token cũ bị thu hồi ngay.
 * Nếu một refresh token đã thu hồi bị dùng lại (nghi bị đánh cắp) → thu hồi toàn bộ phiên của user.
 */
export async function refresh(refreshToken: string): Promise<TokenPair> {
  const userId = verifyToken(refreshToken, 'refresh');
  const tokenHash = hashToken(refreshToken);

  const stored = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { revokedAt: new Date() } },
  );
  if (!stored || stored.user.toString() !== userId) {
    const reused = await RefreshToken.exists({ tokenHash, revokedAt: { $ne: null } });
    if (reused) await revokeAllUserTokens(userId);
    throw new AppError(401, 'INVALID_TOKEN', 'Refresh token không hợp lệ hoặc đã bị thu hồi');
  }

  const user = await User.findById(userId).select('isActive').lean();
  if (!user || !user.isActive) {
    throw AppError.unauthorized('Tài khoản không tồn tại hoặc đã bị vô hiệu hoá');
  }

  return issueTokenPair(userId);
}

/** Thu hồi refresh token. Idempotent: token không tồn tại / đã thu hồi vẫn trả thành công. */
export async function logout(refreshToken: string): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: hashToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

export async function getProfile(userId: string): Promise<PublicUser> {
  const user = await User.findById(userId).lean();
  if (!user) throw AppError.unauthorized('Tài khoản không tồn tại');
  return toPublicUser(user);
}

/** Đổi mật khẩu: thu hồi mọi phiên cũ rồi cấp cặp token mới cho phiên hiện tại. */
export async function changePassword(
  userId: string,
  { currentPassword, newPassword }: ChangePasswordInput,
): Promise<TokenPair> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw AppError.unauthorized('Tài khoản không tồn tại');
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw AppError.badRequest('Mật khẩu hiện tại không đúng');
  }

  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  await revokeAllUserTokens(user._id);
  return issueTokenPair(user._id);
}
