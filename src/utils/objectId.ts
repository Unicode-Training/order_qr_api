import { z } from 'zod';

/** Schema zod cho ObjectId MongoDB (24 ký tự hex). */
export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'ID không hợp lệ');

/** Schema params dạng `/:id`. */
export const idParamsSchema = z.object({ id: objectIdSchema });
