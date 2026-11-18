import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

/**
 * Trạng thái đơn:
 * pending → confirmed → preparing → ready → served; pending/confirmed có thể → cancelled.
 * Nếu `settings.ordering.requireStaffConfirm = false`, đơn được tạo ở trạng thái confirmed.
 */
export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'served',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Ai thay đổi trạng thái: khách (qua phiên bàn), nhân viên (userId) hoặc hệ thống (tự xác nhận). */
export const ACTOR_TYPES = ['guest', 'staff', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export interface IStatusActor {
  type: ActorType;
  /** userId khi type = staff. */
  userId: Types.ObjectId | null;
}

export interface IStatusHistoryEntry {
  status: OrderStatus;
  at: Date;
  by: IStatusActor;
  note: string | null;
}

export interface ISelectedOptionSnapshot {
  groupId: Types.ObjectId;
  groupName: string;
  optionId: Types.ObjectId;
  optionName: string;
  priceDelta: number;
}

export interface IOrderItem {
  _id: Types.ObjectId;
  menuItemId: Types.ObjectId;
  nameSnapshot: string;
  /** Giá gốc của món tại thời điểm đặt (chưa cộng lựa chọn). */
  priceSnapshot: number;
  quantity: number;
  selectedOptions: ISelectedOptionSnapshot[];
  /** priceSnapshot + tổng priceDelta của các lựa chọn. */
  unitPrice: number;
  /** unitPrice × quantity. */
  lineTotal: number;
  note: string | null;
  itemStatus: OrderStatus;
}

export interface IOrder {
  /** Mã đơn dễ đọc, ví dụ "ORD-0802" — đánh số lại từ 0001 mỗi ngày (theo giờ nhà hàng). */
  orderNumber: string;
  /** Ngày kinh doanh YYYY-MM-DD (múi giờ nhà hàng) — cùng orderNumber tạo thành khoá duy nhất. */
  businessDate: string;
  sessionId: Types.ObjectId;
  tableId: Types.ObjectId;
  items: IOrderItem[];
  note: string | null;
  status: OrderStatus;
  subtotal: number;
  statusHistory: IStatusHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export type OrderDocument = HydratedDocument<IOrder>;

const actorSchema = new Schema<IStatusActor>(
  {
    type: { type: String, enum: ACTOR_TYPES, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const statusHistorySchema = new Schema<IStatusHistoryEntry>(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    by: { type: actorSchema, required: true },
    note: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
);

const selectedOptionSchema = new Schema<ISelectedOptionSnapshot>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    groupName: { type: String, required: true },
    optionId: { type: Schema.Types.ObjectId, required: true },
    optionName: { type: String, required: true },
    priceDelta: { type: Number, default: 0 },
  },
  { _id: false },
);

const orderItemSchema = new Schema<IOrderItem>({
  menuItemId: { type: Schema.Types.ObjectId, ref: 'MenuItem', required: true },
  nameSnapshot: { type: String, required: true },
  priceSnapshot: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  selectedOptions: { type: [selectedOptionSchema], default: [] },
  unitPrice: { type: Number, required: true },
  lineTotal: { type: Number, required: true },
  note: { type: String, default: null, maxlength: 300 },
  itemStatus: { type: String, enum: ORDER_STATUSES, required: true },
});

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true },
    businessDate: { type: String, required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'TableSession', required: true },
    tableId: { type: Schema.Types.ObjectId, ref: 'Table', required: true },
    items: { type: [orderItemSchema], required: true },
    note: { type: String, default: null, maxlength: 500 },
    status: { type: String, enum: ORDER_STATUSES, required: true, index: true },
    subtotal: { type: Number, required: true, min: 0 },
    statusHistory: { type: [statusHistorySchema], default: [] },
  },
  { timestamps: true },
);

orderSchema.index({ businessDate: 1, orderNumber: 1 }, { unique: true });
orderSchema.index({ sessionId: 1, createdAt: -1 });
orderSchema.index({ sessionId: 1, updatedAt: 1 });
orderSchema.index({ tableId: 1, createdAt: -1 });

export const Order = model<IOrder>('Order', orderSchema);

/** Bộ đếm số đơn theo ngày (key = businessDate). */
interface IOrderCounter {
  key: string;
  seq: number;
}

const orderCounterSchema = new Schema<IOrderCounter>({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, required: true, default: 0 },
});

export const OrderCounter = model<IOrderCounter>('OrderCounter', orderCounterSchema);
