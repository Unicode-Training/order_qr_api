import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import type { GuestSessionRef } from '../orders/order.service';
import { TableSession } from './tableSession.model';

export const SESSION_TOKEN_HEADER = 'x-session-token';

declare module 'express-serve-static-core' {
  interface Request {
    /** Phiên bàn của khách — được gắn bởi middleware `requireGuestSession`. */
    guestSession?: GuestSessionRef;
  }
}

const TOKEN_FORMAT = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Xác thực khách bằng header `X-Session-Token` (token nhận từ POST /public/sessions).
 * Token sai/không tồn tại → 401 INVALID_SESSION; phiên đã đóng → 401 SESSION_CLOSED
 * (client nên xoá token trong localStorage và quét lại QR).
 */
export async function requireGuestSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.get(SESSION_TOKEN_HEADER)?.trim();
  if (!token) {
    throw new AppError(401, 'INVALID_SESSION', 'Thiếu mã phiên bàn (header X-Session-Token)');
  }
  const session = TOKEN_FORMAT.test(token)
    ? await TableSession.findOne({ sessionToken: token }).select('tableId status').lean()
    : null;
  if (!session) {
    throw new AppError(401, 'INVALID_SESSION', 'Phiên bàn không hợp lệ, vui lòng quét lại mã QR');
  }
  if (session.status === 'closed') {
    throw new AppError(401, 'SESSION_CLOSED', 'Phiên bàn đã kết thúc, vui lòng quét lại mã QR');
  }
  req.guestSession = {
    id: session._id.toString(),
    tableId: session.tableId.toString(),
    status: session.status,
  };
  next();
}

/** Lấy phiên khách trong controller (chỉ dùng sau `requireGuestSession`). */
export function getGuestSession(req: Request): GuestSessionRef {
  if (!req.guestSession) throw new AppError(401, 'INVALID_SESSION', 'Phiên bàn không hợp lệ');
  return req.guestSession;
}
