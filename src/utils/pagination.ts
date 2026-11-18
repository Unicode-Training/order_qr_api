import { z } from 'zod';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** Schema zod cho query phân trang: ?page=1&limit=20&sort=-createdAt,name */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  sort: z.string().trim().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type SortOrder = 1 | -1;

export interface PaginationOptions {
  page: number;
  limit: number;
  skip: number;
  sort: Record<string, SortOrder>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Chuyển chuỗi sort ("-createdAt,name") thành object sort của Mongoose.
 * Chỉ chấp nhận các field nằm trong allowedFields (nếu được truyền) để tránh sort theo field tuỳ ý.
 */
export function parseSort(
  sort: string | undefined,
  allowedFields?: readonly string[],
  defaultSort: Record<string, SortOrder> = { createdAt: -1 },
): Record<string, SortOrder> {
  if (!sort) return { ...defaultSort };
  const result: Record<string, SortOrder> = {};
  for (const raw of sort.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const desc = token.startsWith('-');
    const field = token.replace(/^[-+]/, '');
    if (!/^[A-Za-z0-9_.]+$/.test(field)) continue;
    if (allowedFields && !allowedFields.includes(field)) continue;
    result[field] = desc ? -1 : 1;
  }
  return Object.keys(result).length > 0 ? result : { ...defaultSort };
}

export function getPaginationOptions(
  query: Partial<PaginationQuery>,
  options: { allowedSortFields?: readonly string[]; defaultSort?: Record<string, SortOrder> } = {},
): PaginationOptions {
  const page = Math.max(DEFAULT_PAGE, Math.floor(query.page ?? DEFAULT_PAGE));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)));
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    sort: parseSort(query.sort, options.allowedSortFields, options.defaultSort),
  };
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}
