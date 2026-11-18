import type { Response } from 'express';

export interface SuccessResponse<T, M = Record<string, unknown>> {
  success: true;
  data: T;
  meta?: M;
}

/** Trả về JSON thành công theo định dạng thống nhất: { success: true, data, meta? } */
export function sendSuccess<T, M = Record<string, unknown>>(
  res: Response,
  data: T,
  options: { statusCode?: number; meta?: M } = {},
): Response<SuccessResponse<T, M>> {
  const body: SuccessResponse<T, M> = { success: true, data };
  if (options.meta !== undefined) body.meta = options.meta;
  return res.status(options.statusCode ?? 200).json(body);
}

export function sendCreated<T>(res: Response, data: T): Response<SuccessResponse<T>> {
  return sendSuccess(res, data, { statusCode: 201 });
}
