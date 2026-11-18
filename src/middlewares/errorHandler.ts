import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { AppError, ErrorCode } from '../utils/AppError';
import { logger } from '../utils/logger';

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function hasProp<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value;
}

function normalizeError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return AppError.validation(
      'Dữ liệu không hợp lệ',
      err.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return AppError.validation(
      'Dữ liệu không hợp lệ',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }

  if (err instanceof mongoose.Error.CastError) {
    return AppError.badRequest(`Giá trị không hợp lệ cho trường "${err.path}"`, {
      path: err.path,
      value: err.value,
    });
  }

  // Lỗi trùng unique index của MongoDB
  if (hasProp(err, 'code') && err.code === 11000) {
    const keyValue = hasProp(err, 'keyValue') ? err.keyValue : undefined;
    return AppError.conflict('Dữ liệu đã tồn tại', keyValue);
  }

  // Lỗi từ body-parser (express.json): JSON sai cú pháp, payload quá lớn...
  if (hasProp(err, 'type') && hasProp(err, 'status') && typeof err.status === 'number') {
    if (err.type === 'entity.parse.failed') {
      return AppError.badRequest('Body JSON không hợp lệ');
    }
    if (err.type === 'entity.too.large') {
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Dữ liệu gửi lên quá lớn');
    }
    if (err.status >= 400 && err.status < 500) {
      const message = hasProp(err, 'message') ? String(err.message) : 'Yêu cầu không hợp lệ';
      return new AppError(err.status, ErrorCode.BAD_REQUEST, message);
    }
  }

  return AppError.internal();
}

// Express nhận diện error handler qua số tham số (4) nên phải giữ đủ chữ ký.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = normalizeError(err);

  if (appError.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${appError.statusCode}`, err);
  }

  const body: ErrorResponse = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
    },
  };
  if (appError.details !== undefined) {
    body.error.details = appError.details;
  } else if (!isProduction && appError.code === ErrorCode.INTERNAL_ERROR && err instanceof Error) {
    body.error.details = { message: err.message, stack: err.stack };
  }

  res.status(appError.statusCode).json(body);
}
