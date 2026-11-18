import { z } from 'zod';
import { objectIdSchema } from '../../utils/objectId';
import { paginationQuerySchema } from '../../utils/pagination';
import { ORDER_STATUSES } from './order.model';
import { createOrderSchema } from './order.schema';
import { ITEM_UPDATABLE_STATUSES } from './orderStatus';

const businessDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD');

const updatedSinceSchema = z.iso
  .datetime({ offset: true, message: 'updatedSince phải là thời gian ISO 8601' })
  .transform((value) => new Date(value));

/** ?status=pending,confirmed — một hoặc nhiều trạng thái, cách nhau bởi dấu phẩy. */
export function statusListQuery<const T extends readonly [string, ...string[]]>(values: T) {
  return z
    .string()
    .trim()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).min(1, 'Cần ít nhất một trạng thái'))
    .transform((list) => [...new Set(list)])
    .optional();
}

export const ADMIN_ORDER_SORT_FIELDS = ['createdAt', 'updatedAt', 'orderNumber', 'subtotal'];

export const listAdminOrdersQuerySchema = paginationQuerySchema
  .extend({
    status: statusListQuery(ORDER_STATUSES),
    tableId: objectIdSchema.optional(),
    areaId: objectIdSchema.optional(),
    /** Ngày kinh doanh (giờ nhà hàng), tính cả hai đầu. */
    dateFrom: businessDateSchema.optional(),
    dateTo: businessDateSchema.optional(),
    /** Tìm theo mã đơn (một phần, không phân biệt hoa thường), vd. "0802". */
    search: z.string().trim().max(30).optional(),
    /** Chỉ trả đơn có updatedAt > updatedSince — dashboard polling. */
    updatedSince: updatedSinceSchema.optional(),
  })
  .refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, {
    message: 'dateFrom phải trước hoặc bằng dateTo',
    path: ['dateFrom'],
  });

export const orderBoardQuerySchema = z.object({
  /** Ngày kinh doanh YYYY-MM-DD, mặc định hôm nay (giờ nhà hàng). */
  date: businessDateSchema.optional(),
  areaId: objectIdSchema.optional(),
  tableId: objectIdSchema.optional(),
});

const reasonSchema = z
  .string()
  .trim()
  .max(300, 'Tối đa 300 ký tự')
  .nullish()
  .transform((value) => value || null);

export const updateOrderStatusSchema = z
  .object({
    status: z.enum(ORDER_STATUSES),
    /** Bắt buộc khi huỷ đơn; tuỳ chọn với các trạng thái khác (ghi vào statusHistory.note). */
    reason: reasonSchema,
  })
  .refine((body) => body.status !== 'cancelled' || !!body.reason, {
    message: 'Vui lòng nhập lý do huỷ đơn',
    path: ['reason'],
  });

export const updateOrderItemSchema = z
  .object({
    itemStatus: z.enum(ITEM_UPDATABLE_STATUSES).optional(),
    /** true → huỷ món vì hết + đánh dấu món trong thực đơn là hết (isAvailable=false). */
    markSoldOut: z.boolean().optional(),
    /** Bắt buộc khi huỷ món (trừ khi markSoldOut — mặc định "Hết món"). */
    reason: reasonSchema,
  })
  .refine((body) => body.itemStatus !== undefined || body.markSoldOut === true, {
    message: 'Cần itemStatus hoặc markSoldOut=true',
    path: ['itemStatus'],
  })
  .refine((body) => !body.markSoldOut || !body.itemStatus || body.itemStatus === 'cancelled', {
    message: 'markSoldOut chỉ đi kèm itemStatus=cancelled',
    path: ['itemStatus'],
  })
  .refine((body) => body.itemStatus !== 'cancelled' || body.markSoldOut || !!body.reason, {
    message: 'Vui lòng nhập lý do huỷ món',
    path: ['reason'],
  });

export const orderItemParamsSchema = z.object({ id: objectIdSchema, itemId: objectIdSchema });

/** Nhân viên tạo đơn thay khách — cùng định dạng body với khách. */
export const staffCreateOrderSchema = createOrderSchema;

export type ListAdminOrdersQuery = z.output<typeof listAdminOrdersQuerySchema>;
export type OrderBoardQuery = z.output<typeof orderBoardQuerySchema>;
export type UpdateOrderStatusInput = z.output<typeof updateOrderStatusSchema>;
export type UpdateOrderItemInput = z.output<typeof updateOrderItemSchema>;
export type StaffCreateOrderInput = z.output<typeof staffCreateOrderSchema>;
