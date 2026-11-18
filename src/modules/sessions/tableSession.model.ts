import { randomBytes } from 'node:crypto';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

/**
 * Trạng thái phiên bàn:
 * - open              : khách đang dùng bữa, được gọi món
 * - payment_requested : khách đã yêu cầu thanh toán (vẫn còn hiệu lực, không gọi thêm món)
 * - closed            : đã đóng — token phiên không còn dùng được
 */
export const SESSION_STATUSES = ['open', 'payment_requested', 'closed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/** Token phiên 256 bit, base64url (43 ký tự) — client lưu localStorage, gửi qua header X-Session-Token. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Lý do đóng phiên: đã thanh toán, hoặc nhân viên huỷ phiên trống. */
export const SESSION_CLOSE_REASONS = ['paid', 'cancelled'] as const;
export type SessionCloseReason = (typeof SESSION_CLOSE_REASONS)[number];

export interface ITableSession {
  tableId: Types.ObjectId;
  sessionToken: string;
  status: SessionStatus;
  /**
   * Nội bộ: true khi phiên chưa đóng. Có unique index một phần (tableId, isActive=true) để mỗi bàn
   * chỉ có tối đa một phiên chưa đóng, kể cả khi nhiều khách quét QR cùng lúc.
   */
  isActive: boolean;
  guestCount: number | null;
  customerName: string | null;
  note: string | null;
  openedAt: Date;
  closedAt: Date | null;
  closeReason: SessionCloseReason | null;
  /** Nhân viên đóng phiên (thu tiền / huỷ). */
  closedBy: Types.ObjectId | null;
  /** Phương thức khách muốn dùng khi yêu cầu thanh toán. */
  preferredPaymentMethod: string | null;
  paymentRequestedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TableSessionDocument = HydratedDocument<ITableSession>;

const tableSessionSchema = new Schema<ITableSession>(
  {
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true, index: true },
    sessionToken: { type: String, required: true, unique: true, default: generateSessionToken },
    status: { type: String, enum: SESSION_STATUSES, default: 'open', index: true },
    isActive: { type: Boolean, default: true },
    guestCount: { type: Number, default: null, min: 1, max: 100 },
    customerName: { type: String, default: null, trim: true, maxlength: 100 },
    note: { type: String, default: null, trim: true, maxlength: 500 },
    openedAt: { type: Date, default: () => new Date() },
    closedAt: { type: Date, default: null },
    closeReason: { type: String, enum: [...SESSION_CLOSE_REASONS, null], default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    preferredPaymentMethod: { type: String, default: null },
    paymentRequestedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

tableSessionSchema.index(
  { tableId: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: 'one_active_session_per_table',
  },
);

tableSessionSchema.pre('validate', function syncIsActive() {
  this.isActive = this.status !== 'closed';
});

export const TableSession = model<ITableSession>('TableSession', tableSessionSchema);
