import { z } from 'zod';
import { objectIdSchema } from '../../utils/objectId';
import { paginationQuerySchema } from '../../utils/pagination';
import { isValidDateString } from '../../utils/zonedDate';
import { statusListQuery } from '../orders/adminOrder.schema';
import { updateSessionSchema } from '../sessions/session.schema';
import { SESSION_CLOSE_REASONS, SESSION_STATUSES } from '../sessions/tableSession.model';

/** Ngày lịch YYYY-MM-DD (giờ nhà hàng). */
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày dạng YYYY-MM-DD')
  .refine(isValidDateString, 'Ngày không tồn tại');

export const ADMIN_SESSION_SORT_FIELDS = ['openedAt', 'closedAt', 'createdAt', 'updatedAt'];

export const listAdminSessionsQuerySchema = paginationQuerySchema
  .extend({
    /**
     * Một hoặc nhiều trạng thái, cách nhau bởi dấu phẩy. Mặc định: phiên chưa đóng
     * (open, payment_requested); nếu có `closeReason` thì mặc định `closed`.
     */
    status: statusListQuery(SESSION_STATUSES),
    tableId: objectIdSchema.optional(),
    areaId: objectIdSchema.optional(),
    /** Ngày mở phiên (giờ nhà hàng) từ ngày này, gồm cả ngày này. */
    from: dateOnly.optional(),
    /** Ngày mở phiên tới ngày này, gồm cả ngày này. */
    to: dateOnly.optional(),
    closeReason: z.enum(SESSION_CLOSE_REASONS).optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    path: ['to'],
    message: '`to` phải sau hoặc bằng `from`',
  });

/** Nhân viên sửa số khách / tên / ghi chú — cùng định dạng với PATCH /public/sessions/current. */
export const updateAdminSessionSchema = updateSessionSchema;

export type ListAdminSessionsQuery = z.output<typeof listAdminSessionsQuerySchema>;
export type UpdateAdminSessionInput = z.output<typeof updateAdminSessionSchema>;
