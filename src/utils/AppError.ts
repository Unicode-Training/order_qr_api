export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode] | (string & {});

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCodeValue;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCodeValue, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Yêu cầu không hợp lệ', details?: unknown) {
    return new AppError(400, ErrorCode.BAD_REQUEST, message, details);
  }

  static validation(message = 'Dữ liệu không hợp lệ', details?: unknown) {
    return new AppError(400, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static unauthorized(message = 'Chưa xác thực', details?: unknown) {
    return new AppError(401, ErrorCode.UNAUTHORIZED, message, details);
  }

  static forbidden(message = 'Không có quyền truy cập', details?: unknown) {
    return new AppError(403, ErrorCode.FORBIDDEN, message, details);
  }

  static notFound(message = 'Không tìm thấy tài nguyên', details?: unknown) {
    return new AppError(404, ErrorCode.NOT_FOUND, message, details);
  }

  static conflict(message = 'Dữ liệu bị trùng lặp', details?: unknown) {
    return new AppError(409, ErrorCode.CONFLICT, message, details);
  }

  static tooManyRequests(message = 'Quá nhiều yêu cầu, vui lòng thử lại sau', details?: unknown) {
    return new AppError(429, ErrorCode.TOO_MANY_REQUESTS, message, details);
  }

  static serviceUnavailable(message = 'Dịch vụ tạm thời không khả dụng', details?: unknown) {
    return new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, message, details);
  }

  static internal(message = 'Lỗi hệ thống', details?: unknown) {
    return new AppError(500, ErrorCode.INTERNAL_ERROR, message, details);
  }
}
