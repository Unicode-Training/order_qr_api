import type { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { Order, type IOrder, type OrderStatus } from '../orders/order.model';
import { BILLABLE_STATUSES } from '../orders/order.service';
import { calculateBillTotals, type BillTotals } from '../orders/pricing';
import {
  TableSession,
  type ITableSession,
  type SessionStatus,
} from '../sessions/tableSession.model';
import type { PaymentMethod } from '../settings/settings.schema';
import { getSettings, type AdminSettings } from '../settings/settings.service';
import { Table } from '../tables/table.model';

/** Đơn "chưa xử lý xong" — chặn thu tiền (trừ khi force). `ready` = món đã xong, chờ mang ra. */
export const UNFINISHED_ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing'];

export type LeanSession = ITableSession & { _id: Types.ObjectId };
type LeanOrder = IOrder & { _id: Types.ObjectId };

export interface BillItem {
  orderId: string;
  orderNumber: string;
  itemId: string;
  name: string;
  /** Tên các lựa chọn, vd. ["Lớn", "Thêm trứng"]. */
  options: string[];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note: string | null;
  itemStatus: OrderStatus;
}

export interface BillOrderRef {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  createdAt: Date;
}

export interface BankTransferInstructions {
  bankName: string;
  accountNumber: string;
  accountName: string;
  /** Số tiền cần chuyển (= total). */
  amount: number;
  /** Nội dung chuyển khoản gợi ý để nhân viên đối soát. */
  transferContent: string;
}

export interface Bill extends BillTotals {
  sessionId: string;
  sessionStatus: SessionStatus;
  table: { id: string; code: string; name: string };
  openedAt: Date;
  guestCount: number | null;
  preferredPaymentMethod: string | null;
  paymentRequestedAt: Date | null;
  orders: BillOrderRef[];
  items: BillItem[];
  /** Tổng số phần món được tính tiền. */
  itemCount: number;
  /** Đơn còn pending/confirmed/preparing — nhân viên cần xử lý trước khi thu tiền. */
  unfinishedOrders: BillOrderRef[];
  paymentMethods: PaymentMethod[];
  /** Chỉ có khi nhà hàng bật bank_transfer và đã nhập thông tin tài khoản. */
  bankTransfer: BankTransferInstructions | null;
  generatedAt: Date;
}

/** Dữ liệu tính tiền nội bộ (dùng khi ghi nhận thanh toán). */
export interface BillComputation {
  bill: Bill;
  orderIds: Types.ObjectId[];
  settings: AdminSettings;
}

function toOrderRef(order: LeanOrder): BillOrderRef {
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
  };
}

/**
 * Tính hoá đơn của phiên: gộp mọi đơn không bị huỷ (bỏ món đã huỷ trong đơn),
 * tính phí phục vụ/VAT bằng hàm dùng chung `calculateBillTotals`, trừ giảm giá (nếu có).
 */
export async function computeBill(
  session: LeanSession,
  discountAmount = 0,
): Promise<BillComputation> {
  const [orders, settings, table] = await Promise.all([
    Order.find({ sessionId: session._id, status: { $in: BILLABLE_STATUSES } })
      .sort({ createdAt: 1, _id: 1 })
      .lean<LeanOrder[]>(),
    getSettings(),
    Table.findById(session.tableId).select('code name').lean(),
  ]);
  if (!table) throw AppError.notFound('Không tìm thấy bàn');

  const items: BillItem[] = [];
  for (const order of orders) {
    for (const item of order.items) {
      if (item.itemStatus === 'cancelled') continue;
      items.push({
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        itemId: item._id.toString(),
        name: item.nameSnapshot,
        options: (item.selectedOptions ?? []).map((option) => option.optionName),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        note: item.note ?? null,
        itemStatus: item.itemStatus,
      });
    }
  }

  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const totals = calculateBillTotals(
    subtotal,
    {
      currency: settings.currency,
      vatPercent: settings.vatPercent,
      serviceChargePercent: settings.serviceChargePercent,
    },
    discountAmount,
  );

  const bankInfo = settings.paymentMethods.includes('bank_transfer')
    ? settings.bankTransferInfo
    : null;

  const bill: Bill = {
    sessionId: session._id.toString(),
    sessionStatus: session.status,
    table: { id: table._id.toString(), code: table.code, name: table.name },
    openedAt: session.openedAt,
    guestCount: session.guestCount ?? null,
    preferredPaymentMethod: session.preferredPaymentMethod ?? null,
    paymentRequestedAt: session.paymentRequestedAt ?? null,
    orders: orders.map(toOrderRef),
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    unfinishedOrders: orders
      .filter((order) => UNFINISHED_ORDER_STATUSES.includes(order.status))
      .map(toOrderRef),
    ...totals,
    paymentMethods: settings.paymentMethods,
    bankTransfer: bankInfo
      ? {
          bankName: bankInfo.bankName,
          accountNumber: bankInfo.accountNumber,
          accountName: bankInfo.accountName,
          amount: totals.total,
          transferContent: `${table.code} ${session._id.toString().slice(-6).toUpperCase()}`,
        }
      : null,
    generatedAt: new Date(),
  };

  return { bill, orderIds: orders.map((order) => order._id), settings };
}

/** Phiên chưa đóng theo id (cho nhân viên). Đã đóng → 409 SESSION_CLOSED. */
export async function loadActiveSession(sessionId: string): Promise<LeanSession> {
  const session = await TableSession.findById(sessionId).lean<LeanSession>();
  if (!session) throw AppError.notFound('Không tìm thấy phiên bàn');
  if (session.status === 'closed') {
    throw new AppError(409, 'SESSION_CLOSED', 'Phiên bàn đã đóng');
  }
  return session;
}

/** Phiên chưa đóng của bàn. Bàn không có phiên → 404 NO_ACTIVE_SESSION. */
export async function loadActiveSessionOfTable(tableId: string): Promise<LeanSession> {
  const table = await Table.exists({ _id: tableId });
  if (!table) throw AppError.notFound('Không tìm thấy bàn');
  const session = await TableSession.findOne({ tableId, isActive: true }).lean<LeanSession>();
  if (!session) {
    throw new AppError(404, 'NO_ACTIVE_SESSION', 'Bàn hiện không có phiên đang phục vụ');
  }
  return session;
}

export async function getBillOfSession(sessionId: string): Promise<Bill> {
  return (await computeBill(await loadActiveSession(sessionId))).bill;
}

export async function getBillOfTable(tableId: string): Promise<Bill> {
  return (await computeBill(await loadActiveSessionOfTable(tableId))).bill;
}
