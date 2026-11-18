import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

/** Loại yêu cầu nhanh tại bàn. */
export const SERVICE_REQUEST_TYPES = [
  'call_staff',
  'request_water',
  'request_utensils',
  'request_bill',
  'other',
] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

/** pending → acknowledged → done (pending cũng có thể → done thẳng). */
export const SERVICE_REQUEST_STATUSES = ['pending', 'acknowledged', 'done'] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

/** Các trạng thái được coi là "còn mở" (đóng phiên → chuyển hết sang done). */
export const OPEN_SERVICE_REQUEST_STATUSES: ServiceRequestStatus[] = ['pending', 'acknowledged'];

export interface IServiceRequest {
  sessionId: Types.ObjectId;
  tableId: Types.ObjectId;
  type: ServiceRequestType;
  note: string | null;
  status: ServiceRequestStatus;
  /** Nhân viên xử lý gần nhất. */
  handledBy: Types.ObjectId | null;
  /** request_bill (từ POST /public/sessions/current/request-bill): phương thức khách muốn dùng. */
  preferredMethod?: string | null;
  acknowledgedAt: Date | null;
  doneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ServiceRequestDocument = HydratedDocument<IServiceRequest>;

const serviceRequestSchema = new Schema<IServiceRequest>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    type: { type: String, enum: SERVICE_REQUEST_TYPES, required: true },
    note: { type: String, default: null, trim: true, maxlength: 300 },
    status: { type: String, enum: SERVICE_REQUEST_STATUSES, default: 'pending' },
    handledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    preferredMethod: { type: String, default: null },
    acknowledgedAt: { type: Date, default: null },
    doneAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/** Chống spam: mỗi phiên chỉ có tối đa MỘT yêu cầu đang pending cho mỗi loại (an toàn khi bấm đồng thời). */
serviceRequestSchema.index(
  { sessionId: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'one_pending_request_per_type',
  },
);
serviceRequestSchema.index({ sessionId: 1, createdAt: -1 });
serviceRequestSchema.index({ status: 1, createdAt: 1 });
serviceRequestSchema.index({ updatedAt: 1 });

export const ServiceRequest = model<IServiceRequest>('ServiceRequest', serviceRequestSchema);
