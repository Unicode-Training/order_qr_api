import { z } from 'zod';
import { objectIdSchema } from '../../utils/objectId';

/** Số dòng món tối đa trong một đơn/quote. */
export const MAX_ORDER_LINES = 50;

/** Chuỗi tuỳ chọn: trim, chuỗi rỗng → null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự`)
    .nullish()
    .transform((value) => value || null);

export const orderLineSchema = z.object({
  menuItemId: objectIdSchema,
  quantity: z.number('Phải là số').int('Phải là số nguyên').min(1, 'Tối thiểu 1').max(1000),
  /** id các lựa chọn đã chọn (thuộc optionGroups của món) — server tự xác định nhóm. */
  optionIds: z
    .array(objectIdSchema)
    .max(50)
    .default([])
    .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
      message: 'Lựa chọn bị trùng',
    }),
  note: optionalText(300),
});

const linesSchema = z
  .array(orderLineSchema)
  .min(1, 'Giỏ hàng trống')
  .max(MAX_ORDER_LINES, `Tối đa ${MAX_ORDER_LINES} dòng món mỗi đơn`);

export const quoteOrderSchema = z.object({ items: linesSchema });

export const createOrderSchema = z.object({
  items: linesSchema,
  note: optionalText(500),
});

export const cancelOrderSchema = z
  .object({ reason: optionalText(300) })
  .optional()
  .transform((body) => body ?? { reason: null });

export const listSessionOrdersQuerySchema = z.object({
  /** Chỉ trả đơn có updatedAt > updatedSince (ISO 8601) — để client polling nhẹ. */
  updatedSince: z.iso
    .datetime({ offset: true, message: 'updatedSince phải là thời gian ISO 8601' })
    .transform((value) => new Date(value))
    .optional(),
});

export type OrderLineInput = z.output<typeof orderLineSchema>;
export type QuoteOrderInput = z.output<typeof quoteOrderSchema>;
export type CreateOrderInput = z.output<typeof createOrderSchema>;
export type CancelOrderInput = z.output<typeof cancelOrderSchema>;
export type ListSessionOrdersQuery = z.output<typeof listSessionOrdersQuerySchema>;
