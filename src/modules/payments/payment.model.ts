import { model, Schema, type HydratedDocument, type Types } from 'mongoose';
import { logger } from '../../utils/logger';
import { PAYMENT_METHODS, type PaymentMethod } from '../settings/settings.schema';

export const PAYMENT_STATUSES = ['completed', 'voided'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Điều kiện "thanh toán còn hiệu lực" cho mọi truy vấn doanh thu (bản ghi cũ chưa có status = completed). */
export const COUNTED_PAYMENT_FILTER = { status: { $ne: 'voided' } } as const;

/** Bản ghi thanh toán (ghi nhận thủ công bởi nhân viên — không tích hợp cổng thanh toán). */
export interface IPayment {
  sessionId: Types.ObjectId;
  tableId: Types.ObjectId;
  /** Mã bàn tại thời điểm thanh toán (để báo cáo kể cả khi bàn bị đổi/xoá). */
  tableCode: string;
  /** Các đơn (không bị huỷ) được tính trong hoá đơn. */
  orderIds: Types.ObjectId[];
  currency: string;
  subtotal: number;
  serviceChargePercent: number;
  serviceCharge: number;
  vatPercent: number;
  vat: number;
  discount: number;
  discountReason: string | null;
  total: number;
  method: PaymentMethod;
  amountReceived: number;
  change: number;
  note: string | null;
  /** true nếu nhân viên thu tiền khi còn đơn chưa xử lý xong (force). */
  forced: boolean;
  warnings: string[];
  paidAt: Date;
  /** Ngày kinh doanh YYYY-MM-DD (giờ nhà hàng) — dùng để lọc theo ngày. */
  businessDate: string;
  cashierId: Types.ObjectId;
  /** completed (mặc định) | voided — bản ghi bị huỷ (ghi nhầm) không tính vào doanh thu. */
  status: PaymentStatus;
  voidedAt: Date | null;
  voidedBy: Types.ObjectId | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentDocument = HydratedDocument<IPayment>;

const paymentSchema = new Schema<IPayment>(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    tableCode: { type: String, required: true },
    orderIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Order' }], default: [] },
    currency: { type: String, required: true },
    subtotal: { type: Number, required: true, min: 0 },
    serviceChargePercent: { type: Number, required: true, min: 0 },
    serviceCharge: { type: Number, required: true, min: 0 },
    vatPercent: { type: Number, required: true, min: 0 },
    vat: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    discountReason: { type: String, default: null, maxlength: 300 },
    total: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amountReceived: { type: Number, required: true, min: 0 },
    change: { type: Number, required: true, min: 0 },
    note: { type: String, default: null, maxlength: 500 },
    forced: { type: Boolean, default: false },
    warnings: { type: [String], default: [] },
    paidAt: { type: Date, required: true },
    businessDate: { type: String, required: true },
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'completed', required: true },
    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, default: null, maxlength: 300 },
  },
  { timestamps: true },
);

/** Tên index cũ (unique toàn phần trên sessionId) — cần drop khi nâng cấp, xem `migratePaymentIndexes`. */
export const LEGACY_SESSION_INDEX = 'sessionId_1';
export const SESSION_COMPLETED_INDEX = 'sessionId_completed_unique';

// Mỗi phiên chỉ có MỘT thanh toán completed — chặn ghi nhận trùng khi bấm 2 lần / 2 nhân viên cùng thu.
// Bản ghi voided không bị ràng buộc → huỷ thanh toán ghi nhầm rồi thu lại được.
// Đặt tên riêng để không trùng tên với index cũ `sessionId_1` (cùng key, khác option → MongoDB báo conflict).
paymentSchema.index(
  { sessionId: 1 },
  {
    unique: true,
    name: SESSION_COMPLETED_INDEX,
    partialFilterExpression: { status: 'completed' },
  },
);
paymentSchema.index({ businessDate: 1, paidAt: -1 });
paymentSchema.index({ method: 1, paidAt: -1 });
paymentSchema.index({ paidAt: -1 });

export const Payment = model<IPayment>('Payment', paymentSchema);

/**
 * Nâng cấp DB đã có dữ liệu từ phiên bản trước khi có `status` (idempotent, gọi lúc khởi động):
 * 1. Gán `status: 'completed'` cho bản ghi cũ chưa có status (để index một phần bao phủ chúng).
 * 2. Tạo index mới (`syncIndexes`) — đồng thời drop index cũ `sessionId_1` vì không còn khai báo trong schema.
 *    Thứ tự: tạo index mới trước rồi mới drop index cũ → không có khoảng trống không ràng buộc.
 */
export async function migratePaymentIndexes(): Promise<{ backfilled: number; dropped: string[] }> {
  const { modifiedCount } = await Payment.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'completed', voidedAt: null, voidedBy: null, voidReason: null } },
  );
  await Payment.createIndexes();
  const dropped = await Payment.syncIndexes();
  if (modifiedCount > 0 || dropped.length > 0) {
    logger.info(
      `Payment: gán status cho ${modifiedCount} bản ghi cũ, drop index [${dropped.join(', ')}]`,
    );
  }
  return { backfilled: modifiedCount, dropped };
}
