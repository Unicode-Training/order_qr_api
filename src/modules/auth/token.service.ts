import { createHash, randomUUID } from 'node:crypto';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import type { Types } from 'mongoose';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { RefreshToken } from './refreshToken.model';

const ALGORITHM = 'HS256';

type TokenType = 'access' | 'refresh';

export interface TokenPair {
  tokenType: 'Bearer';
  accessToken: string;
  /** Thời điểm access token hết hạn (ISO). */
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sign(userId: string, type: TokenType): { token: string; expiresAt: Date } {
  const secret = type === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  const expiresIn = (
    type === 'access' ? env.JWT_ACCESS_EXPIRES : env.JWT_REFRESH_EXPIRES
  ) as SignOptions['expiresIn'];
  // jti ngẫu nhiên để hai token cấp cùng giây vẫn khác nhau (tokenHash là unique).
  const token = jwt.sign({ type }, secret, {
    algorithm: ALGORITHM,
    subject: userId,
    jwtid: randomUUID(),
    expiresIn,
  });
  const { exp } = jwt.decode(token) as JwtPayload;
  return { token, expiresAt: new Date((exp ?? 0) * 1000) };
}

/** Verify token và trả về userId (sub). Ném 401 nếu sai chữ ký, hết hạn hoặc sai loại token. */
export function verifyToken(token: string, type: TokenType): string {
  const secret = type === 'access' ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
  let payload: string | JwtPayload;
  try {
    payload = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError(401, 'TOKEN_EXPIRED', 'Token đã hết hạn');
    }
    throw new AppError(401, 'INVALID_TOKEN', 'Token không hợp lệ');
  }
  if (typeof payload === 'string' || payload.type !== type || typeof payload.sub !== 'string') {
    throw new AppError(401, 'INVALID_TOKEN', 'Token không hợp lệ');
  }
  return payload.sub;
}

/** Cấp cặp access + refresh token mới và lưu hash refresh token vào DB. */
export async function issueTokenPair(userId: Types.ObjectId | string): Promise<TokenPair> {
  const id = userId.toString();
  const access = sign(id, 'access');
  const refresh = sign(id, 'refresh');
  await RefreshToken.create({
    user: id,
    tokenHash: hashToken(refresh.token),
    expiresAt: refresh.expiresAt,
  });
  return {
    tokenType: 'Bearer',
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
  };
}

/** Thu hồi mọi refresh token còn hiệu lực của user (đăng xuất khỏi mọi thiết bị). */
export async function revokeAllUserTokens(userId: Types.ObjectId | string): Promise<void> {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}
