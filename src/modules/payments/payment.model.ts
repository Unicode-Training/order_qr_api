import { model, Schema, type HydratedDocument, type Types } from 'mongoose';
import { PAYMENT_METHODS, type PaymentMethod } from '../settings/settings.schema';

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
  },
  { timestamps: true },
);

// Mỗi phiên chỉ thanh toán một lần — chặn ghi nhận trùng khi bấm 2 lần / 2 nhân viên cùng thu.
paymentSchema.index({ sessionId: 1 }, { unique: true });
paymentSchema.index({ businessDate: 1, paidAt: -1 });
paymentSchema.index({ method: 1, paidAt: -1 });
paymentSchema.index({ paidAt: -1 });

export const Payment = model<IPayment>('Payment', paymentSchema);
