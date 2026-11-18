import { z } from 'zod';
import { objectIdSchema } from '../../utils/objectId';
import { paginationQuerySchema } from '../../utils/pagination';
import { TABLE_STATUSES } from './table.model';

export const tableCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Mã bàn chỉ gồm chữ, số, "-", "_" (tối đa 20 ký tự)');

const tableNameSchema = z.string().trim().min(1, 'Vui lòng nhập tên bàn').max(100);
const capacitySchema = z.number().int().min(1).max(100);
const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

/** Danh sách id cách nhau bởi dấu phẩy trong query: ?ids=a,b,c */
const idListQuery = z
  .string()
  .trim()
  .transform((value) =>
    value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
  .pipe(z.array(objectIdSchema).max(500));

export const createTableSchema = z.object({
  code: tableCodeSchema,
  /** Mặc định "Bàn <code>" nếu bỏ trống. */
  name: tableNameSchema.optional(),
  areaId: objectIdSchema.nullable().default(null),
  capacity: capacitySchema.default(4),
  isActive: z.boolean().default(true),
});

export const updateTableSchema = z
  .object({
    code: tableCodeSchema,
    name: tableNameSchema,
    areaId: objectIdSchema.nullable(),
    capacity: capacitySchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  });

export const listTablesQuerySchema = paginationQuerySchema.extend({
  /** `none` = bàn chưa gán khu vực. */
  areaId: z.union([objectIdSchema, z.literal('none')]).optional(),
  status: z.enum(TABLE_STATUSES).optional(),
  isActive: booleanQuery,
  /** Tìm theo mã hoặc tên bàn. */
  search: z.string().trim().max(50).optional(),
});

export const qrImageQuerySchema = z.object({
  format: z.enum(['png', 'svg']).default('png'),
  /** Kích thước ảnh (px, cạnh vuông). */
  size: z.coerce.number().int().min(64).max(2048).default(512),
  /** true → Content-Disposition: attachment (tải file). */
  download: booleanQuery,
});

export const qrExportQuerySchema = z.object({
  areaId: objectIdSchema.optional(),
  ids: idListQuery.optional(),
  /** Mặc định chỉ xuất bàn đang hoạt động. */
  includeInactive: booleanQuery,
  size: z.coerce.number().int().min(64).max(2048).default(512),
});

export const qrTokenParamsSchema = z.object({ qrToken: z.string().max(200) });

export type CreateTableInput = z.infer<typeof createTableSchema>;
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
export type ListTablesQuery = z.infer<typeof listTablesQuerySchema>;
export type QrImageQuery = z.infer<typeof qrImageQuerySchema>;
export type QrExportQuery = z.infer<typeof qrExportQuerySchema>;
