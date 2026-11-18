import { z } from 'zod';
import { objectIdSchema } from '../../utils/objectId';
import { paginationQuerySchema } from '../../utils/pagination';
import { statusListQuery } from '../orders/adminOrder.schema';
import { SERVICE_REQUEST_STATUSES, SERVICE_REQUEST_TYPES } from './serviceRequest.model';

const updatedSinceSchema = z.iso
  .datetime({ offset: true, message: 'updatedSince phải là thời gian ISO 8601' })
  .transform((value) => new Date(value));

export const createServiceRequestSchema = z.object({
  type: z.enum(SERVICE_REQUEST_TYPES),
  note: z
    .string()
    .trim()
    .max(300, 'Tối đa 300 ký tự')
    .nullish()
    .transform((value) => value || null),
});

export const listGuestServiceRequestsQuerySchema = z.object({
  updatedSince: updatedSinceSchema.optional(),
});

export const listAdminServiceRequestsQuerySchema = paginationQuerySchema.extend({
  /** Một hoặc nhiều trạng thái, cách nhau bởi dấu phẩy. */
  status: statusListQuery(SERVICE_REQUEST_STATUSES),
  type: statusListQuery(SERVICE_REQUEST_TYPES),
  tableId: objectIdSchema.optional(),
  areaId: objectIdSchema.optional(),
  updatedSince: updatedSinceSchema.optional(),
});

export const updateServiceRequestSchema = z.object({
  status: z.enum(['acknowledged', 'done']),
});

export type CreateServiceRequestInput = z.output<typeof createServiceRequestSchema>;
export type ListGuestServiceRequestsQuery = z.output<typeof listGuestServiceRequestsQuerySchema>;
export type ListAdminServiceRequestsQuery = z.output<typeof listAdminServiceRequestsQuerySchema>;
export type UpdateServiceRequestInput = z.output<typeof updateServiceRequestSchema>;
