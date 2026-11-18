import { z } from 'zod';

const areaNameSchema = z.string().trim().min(1, 'Vui lòng nhập tên khu vực').max(100);
const sortOrderSchema = z.number().int().min(-100000).max(100000);

export const createAreaSchema = z.object({
  name: areaNameSchema,
  sortOrder: sortOrderSchema.default(0),
});

export const updateAreaSchema = z
  .object({ name: areaNameSchema, sortOrder: sortOrderSchema })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  });

export type CreateAreaInput = z.infer<typeof createAreaSchema>;
export type UpdateAreaInput = z.infer<typeof updateAreaSchema>;
