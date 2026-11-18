import type { NextFunction, Request, Response } from 'express';
import { User } from '../modules/users/user.model';
import { verifyToken } from '../modules/auth/token.service';
import { AppError } from '../utils/AppError';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** User đã xác thực — được gắn bởi middleware `authenticate`. */
    user?: AuthUser;
  }
}

/**
 * Xác thực bằng header `Authorization: Bearer <accessToken>`.
 * Mỗi request đều kiểm tra lại user trong DB nên tài khoản bị vô hiệu hoá mất quyền ngay lập tức.
 * Không có phân quyền theo vai trò: mọi tài khoản đăng nhập hợp lệ đều có toàn quyền.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
  if (!match?.[1]) {
    throw AppError.unauthorized('Thiếu access token (Authorization: Bearer <token>)');
  }

  const userId = verifyToken(match[1], 'access');
  const user = await User.findById(userId).select('fullName email isActive').lean();
  if (!user || !user.isActive) {
    throw AppError.unauthorized('Tài khoản không tồn tại hoặc đã bị vô hiệu hoá');
  }

  req.user = { id: user._id.toString(), email: user.email, fullName: user.fullName };
  next();
}

/** Lấy user đã xác thực trong controller (chỉ dùng sau `authenticate`). */
export function getAuthUser(req: Request): AuthUser {
  if (!req.user) throw AppError.unauthorized();
  return req.user;
}
