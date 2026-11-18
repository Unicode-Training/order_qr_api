import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/AppError';

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

type Location = keyof ValidationSchemas;

export interface ValidationIssue {
  location: Location;
  path: string;
  message: string;
  code: string;
}

/**
 * Validate req.body / req.query / req.params bằng zod.
 * Giá trị sau khi parse (đã coerce/default/strip) được gán lại vào req.
 * Lưu ý Express 5: req.query là getter nên phải ghi đè bằng Object.defineProperty.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const issues: ValidationIssue[] = [];
    const parsedValues: Partial<Record<Location, unknown>> = {};

    for (const location of ['params', 'query', 'body'] as const) {
      const schema = schemas[location];
      if (!schema) continue;
      const result = schema.safeParse(req[location] ?? {});
      if (result.success) {
        parsedValues[location] = result.data;
      } else {
        for (const issue of result.error.issues) {
          issues.push({
            location,
            path: issue.path.map(String).join('.'),
            message: issue.message,
            code: issue.code,
          });
        }
      }
    }

    if (issues.length > 0) {
      next(AppError.validation('Dữ liệu không hợp lệ', issues));
      return;
    }

    if ('body' in parsedValues) req.body = parsedValues.body;
    if ('params' in parsedValues) req.params = parsedValues.params as Request['params'];
    if ('query' in parsedValues) {
      Object.defineProperty(req, 'query', {
        value: parsedValues.query,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    next();
  };
}
