import { z } from 'zod';
import { objectIdSchema } from '../../utils/objectId';
import { paginationQuerySchema } from '../../utils/pagination';
import { PAYMENT_METHODS } from '../settings/settings.schema';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự`)
    .nullish()
    .transform((value) => value || null);

const money = z.number('Phải là số').finite().min(0, 'Không được âm').max(1e12);

export const paymentMethodSchema = z.enum(PAYMENT_METHODS, {
  message: 'Phương thức phải là cash, bank_transfer hoặc card',
});

/** Khách yêu cầu thanh toán (body có thể trống). */
export const requestBillSchema = z
  .object({ preferredMethod: paymentMethodSchema.nullish().transform((v) => v ?? null) })
  .optional()
  .transform((body) => body ?? { preferredMethod: null });

export const recordPaymentSchema = z
  .object({
    method: paymentMethodSchema,
    /** Tiền khách đưa. Bắt buộc với tiền mặt; chuyển khoản/thẻ bỏ trống = đúng bằng tổng. */
    amountReceived: money.optional(),
    discountAmount: money.default(0),
    discountReason: optionalText(300),
    note: optionalText(500),
    /** Cho phép thu tiền khi vẫn còn đơn chưa xử lý xong (pending/confirmed/preparing). */
    force: z.boolean().default(false),
  })
  .superRefine((body, ctx) => {
    if (body.method === 'cash' && body.amountReceived === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['amountReceived'],
        message: 'Thanh toán tiền mặt cần nhập số tiền khách đưa',
      });
    }
    if (body.discountAmount > 0 && !body.discountReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountReason'],
        message: 'Vui lòng nhập lý do giảm giá',
      });
    }
  });

export const moveSessionSchema = z.object({ toTableId: objectIdSchema });

export const cancelSessionSchema = z
  .object({ reason: optionalText(300) })
  .optional()
  .transform((body) => body ?? { reason: null });

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD');

export const listPaymentsQuerySchema = paginationQuerySchema
  .extend({
    /** Ngày kinh doanh (giờ nhà hàng) bắt đầu, gồm cả ngày này. */
    from: dateOnly.optional(),
    /** Ngày kinh doanh kết thúc, gồm cả ngày này. */
    to: dateOnly.optional(),
    method: paymentMethodSchema.optional(),
    tableId: objectIdSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: '`to` phải sau hoặc bằng `from`',
  });

export type RequestBillInput = z.output<typeof requestBillSchema>;
export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;
export type MoveSessionInput = z.output<typeof moveSessionSchema>;
export type CancelSessionInput = z.output<typeof cancelSessionSchema>;
export type ListPaymentsQuery = z.output<typeof listPaymentsQuerySchema>;
