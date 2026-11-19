import { randomBytes } from 'node:crypto';
import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

/**
 * Trạng thái bàn:
 * - available     : trống
 * - occupied      : đang phục vụ (có phiên bàn đang mở)
 * - needs_payment : khách đã yêu cầu thanh toán
 * - reserved      : đã đặt trước (tuỳ chọn)
 * occupied/needs_payment do module phiên bàn cập nhật qua `setTableStatus()` trong table.service.
 * available ⇄ reserved do nhân viên đặt qua `PATCH /admin/tables/:id/status` (`setTableReservation()`).
 */
export const TABLE_STATUSES = ['available', 'occupied', 'needs_payment', 'reserved'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

/** Trạng thái nhân viên được đặt thủ công (chỉ khi bàn không có phiên đang mở). */
export const MANUAL_TABLE_STATUSES = [
  'available',
  'reserved',
] as const satisfies readonly TableStatus[];
export type ManualTableStatus = (typeof MANUAL_TABLE_STATUSES)[number];

/** Token ngẫu nhiên 192 bit, base64url (32 ký tự) — in vào QR, không đoán được. */
export function generateQrToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface ITable {
  /** Mã bàn in trên bàn, ví dụ "B08" (luôn viết hoa, unique). */
  code: string;
  name: string;
  areaId: Types.ObjectId | null;
  capacity: number;
  isActive: boolean;
  qrToken: string;
  qrTokenUpdatedAt: Date;
  status: TableStatus;
  /** Ghi chú đặt bàn (tên khách, giờ đến…) — chỉ có khi `reserved`, null ở trạng thái khác. */
  reservationNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TableDocument = HydratedDocument<ITable>;

const tableSchema = new Schema<ITable>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    areaId: { type: Schema.Types.ObjectId, ref: 'Area', default: null, index: true },
    capacity: { type: Number, required: true, min: 1, max: 100, default: 4 },
    isActive: { type: Boolean, default: true, index: true },
    qrToken: { type: String, required: true, unique: true, default: generateQrToken },
    qrTokenUpdatedAt: { type: Date, default: () => new Date() },
    status: { type: String, enum: TABLE_STATUSES, default: 'available', index: true },
    reservationNote: { type: String, trim: true, maxlength: 200, default: null },
  },
  { timestamps: true },
);

export const Table = model<ITable>('Table', tableSchema);
