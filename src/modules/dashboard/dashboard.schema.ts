import { z } from 'zod';
import { toBusinessDate } from '../orders/order.service';
import { diffDays, isValidDateString } from '../../utils/zonedDate';

/** Ngày lịch YYYY-MM-DD (theo giờ nhà hàng). */
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD')
  .refine(isValidDateString, 'Ngày không tồn tại');

const limitSchema = (defaultValue: number, max: number) =>
  z.coerce.number().int('Phải là số nguyên').min(1).max(max).default(defaultValue);

export const GROUP_BY_VALUES = ['hour', 'day', 'month'] as const;
export type GroupBy = (typeof GROUP_BY_VALUES)[number];

/** Số mốc tối đa theo từng kiểu nhóm (giới hạn độ dài khoảng ngày). */
export const MAX_RANGE_DAYS: Record<GroupBy, number> = {
  hour: 31,
  day: 366,
  month: 366 * 5,
};

export const summaryQuerySchema = z.object({
  /** Ngày cần xem, mặc định hôm nay (giờ nhà hàng). */
  date: dateOnly.optional().transform((value) => value ?? toBusinessDate(new Date())),
});

/**
 * Khoảng ngày from..to (gồm cả hai đầu). Thiếu `from`/`to` → mặc định hôm nay;
 * chỉ có một đầu thì đầu còn lại = đầu đó.
 */
const dateRangeShape = {
  from: dateOnly.optional(),
  to: dateOnly.optional(),
};

function resolveRange<T extends { from?: string; to?: string }>(
  query: T,
): Omit<T, 'from' | 'to'> & { from: string; to: string } {
  const today = toBusinessDate(new Date());
  const from = query.from ?? query.to ?? today;
  const to = query.to ?? query.from ?? today;
  return { ...query, from, to };
}

const rangeOrderRefine = (q: { from: string; to: string }) => q.from <= q.to;
const rangeOrderIssue = { path: ['to'], message: '`to` phải sau hoặc bằng `from`' };

export const revenueQuerySchema = z
  .object({ ...dateRangeShape, groupBy: z.enum(GROUP_BY_VALUES).optional() })
  .transform((q) => {
    const range = resolveRange(q);
    // Mặc định: một ngày → theo giờ; nhiều ngày → theo ngày.
    const groupBy: GroupBy = q.groupBy ?? (range.from === range.to ? 'hour' : 'day');
    return { ...range, groupBy };
  })
  .refine(rangeOrderRefine, rangeOrderIssue)
  .refine((q) => diffDays(q.from, q.to) + 1 <= MAX_RANGE_DAYS[q.groupBy], {
    path: ['to'],
    message:
      'Khoảng ngày quá dài: theo giờ tối đa 31 ngày, theo ngày tối đa 366 ngày, theo tháng tối đa 5 năm',
  });

export const topItemsQuerySchema = z
  .object({ ...dateRangeShape, limit: limitSchema(10, 50) })
  .transform(resolveRange)
  .refine(rangeOrderRefine, rangeOrderIssue);

export const recentOrdersQuerySchema = z.object({ limit: limitSchema(10, 50) });

export const paymentMethodsQuerySchema = z
  .object(dateRangeShape)
  .transform(resolveRange)
  .refine(rangeOrderRefine, rangeOrderIssue);

export type SummaryQuery = z.output<typeof summaryQuerySchema>;
export type RevenueQuery = z.output<typeof revenueQuerySchema>;
export type TopItemsQuery = z.output<typeof topItemsQuerySchema>;
export type RecentOrdersQuery = z.output<typeof recentOrdersQuerySchema>;
export type PaymentMethodsQuery = z.output<typeof paymentMethodsQuerySchema>;
