import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { sendSuccess } from '../../utils/response';
import { getHealthStatus } from './health.service';

export function getHealth(_req: Request, res: Response): void {
  const health = getHealthStatus();
  if (!health.database.connected) {
    throw AppError.serviceUnavailable('Không kết nối được cơ sở dữ liệu', health);
  }
  sendSuccess(res, health);
}
