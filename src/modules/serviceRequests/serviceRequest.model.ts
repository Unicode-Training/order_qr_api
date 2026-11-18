import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

/**
 * Yêu cầu phục vụ của khách gửi tới nhân viên.
 * - request_bill : khách yêu cầu thanh toán
 * - call_staff   : gọi nhân viên (dành cho task sau)
 */
export const SERVICE_REQUEST_TYPES = ['request_bill', 'call_staff'] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

/** open → (acknowledged) → done. Khi phiên đóng, mọi yêu cầu chưa done của phiên chuyển done. */
export const SERVICE_REQUEST_STATUSES = ['open', 'acknowledged', 'done'] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

/** Các trạng thái được coi là "còn mở". */
export const OPEN_SERVICE_REQUEST_STATUSES: ServiceRequestStatus[] = ['open', 'acknowledged'];

export interface IServiceRequest {
  sessionId: Types.ObjectId;
  tableId: Types.ObjectId;
  type: ServiceRequestType;
  status: ServiceRequestStatus;
  /** request_bill: phương thức khách muốn dùng (cash | bank_transfer | card). */
  preferredMethod: string | null;
  note: string | null;
  resolvedAt: Date | null;
  resolvedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ServiceRequestDocument = HydratedDocument<IServiceRequest>;

const serviceRequestSchema = new Schema<IServiceRequest>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    type: { type: String, enum: SERVICE_REQUEST_TYPES, required: true },
    status: { type: String, enum: SERVICE_REQUEST_STATUSES, default: 'open', index: true },
    preferredMethod: { type: String, default: null },
    note: { type: String, default: null, maxlength: 500 },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

serviceRequestSchema.index({ sessionId: 1, type: 1, status: 1 });
serviceRequestSchema.index({ status: 1, createdAt: 1 });

export const ServiceRequest = model<IServiceRequest>('ServiceRequest', serviceRequestSchema);
