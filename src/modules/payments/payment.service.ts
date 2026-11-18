import { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { logger } from '../../utils/logger';
import {
  buildPaginationMeta,
  getPaginationOptions,
  type PaginationMeta,
} from '../../utils/pagination';
import { Order } from '../orders/order.model';
import { BILLABLE_STATUSES, toBusinessDate, type GuestSessionRef } from '../orders/order.service';
import { roundMoney } from '../orders/pricing';
import {
  moveRequestsToTable,
  resolveOpenRequestsOfSession,
  upsertBillRequest,
} from '../serviceRequests/serviceRequest.service';
import {
  TableSession,
  type SessionCloseReason,
  type SessionStatus,
} from '../sessions/tableSession.model';
import type { PaymentMethod } from '../settings/settings.schema';
import { getSettings } from '../settings/settings.service';
import { Table, type TableStatus } from '../tables/table.model';
import { User } from '../users/user.model';
import {
  computeBill,
  loadActiveSession,
  type Bill,
  type BillOrderRef,
  type LeanSession,
} from './bill.service';
import { Payment, type IPayment } from './payment.model';
import type {
  CancelSessionInput,
  ListPaymentsQuery,
  MoveSessionInput,
  RecordPaymentInput,
  RequestBillInput,
} from './payment.schema';

type LeanPayment = IPayment & { _id: Types.ObjectId };

// ------------------------------------------------------------------ DTO

export interface PaymentDto {
  id: string;
  sessionId: string;
  table: { id: string; code: string };
  orderIds: string[];
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
  forced: boolean;
  warnings: string[];
  paidAt: Date;
  businessDate: string;
  cashier: { id: string; fullName: string | null };
  createdAt: Date;
}

function toPaymentDto(payment: LeanPayment, cashierName: string | null): PaymentDto {
  return {
    id: payment._id.toString(),
    sessionId: payment.sessionId.toString(),
    table: { id: payment.tableId.toString(), code: payment.tableCode },
    orderIds: payment.orderIds.map((id) => id.toString()),
    currency: payment.currency,
    subtotal: payment.subtotal,
    serviceChargePercent: payment.serviceChargePercent,
    serviceCharge: payment.serviceCharge,
    vatPercent: payment.vatPercent,
    vat: payment.vat,
    discount: payment.discount,
    discountReason: payment.discountReason ?? null,
    total: payment.total,
    method: payment.method,
    amountReceived: payment.amountReceived,
    change: payment.change,
    note: payment.note ?? null,
    forced: payment.forced,
    warnings: payment.warnings ?? [],
    paidAt: payment.paidAt,
    businessDate: payment.businessDate,
    cashier: { id: payment.cashierId.toString(), fullName: cashierName },
    createdAt: payment.createdAt,
  };
}

async function toPaymentDtos(payments: LeanPayment[]): Promise<PaymentDto[]> {
  const cashierIds = [...new Set(payments.map((p) => p.cashierId.toString()))];
  const users = await User.find({ _id: { $in: cashierIds } })
    .select('fullName')
    .lean();
  const names = new Map(users.map((user) => [user._id.toString(), user.fullName]));
  return payments.map((p) => toPaymentDto(p, names.get(p.cashierId.toString()) ?? null));
}

export interface ClosedSessionInfo {
  id: string;
  status: SessionStatus;
  closeReason: SessionCloseReason | null;
  closedAt: Date | null;
}

export interface TableRef {
  id: string;
  code: string;
  status: TableStatus;
}

// ------------------------------------------------------------------ Đóng / mở lại phiên (nội bộ)

/** Đóng phiên nguyên tử (chỉ khi còn mở). Trả null nếu phiên đã bị đóng bởi request khác. */
async function closeSessionAtomically(
  sessionId: Types.ObjectId,
  reason: SessionCloseReason,
  closedBy: string,
  now: Date,
): Promise<LeanSession | null> {
  // findOneAndUpdate không chạy hook pre('validate') → tự đặt isActive=false.
  return TableSession.findOneAndUpdate(
    { _id: sessionId, isActive: true },
    {
      $set: {
        status: 'closed',
        isActive: false,
        closedAt: now,
        closeReason: reason,
        closedBy: new Types.ObjectId(closedBy),
      },
    },
    { returnDocument: 'after', lean: true },
  ) as Promise<LeanSession | null>;
}

/** Hoàn tác đóng phiên khi bước sau thất bại (best-effort — chỉ log nếu không mở lại được). */
async function reopenSession(previous: LeanSession): Promise<void> {
  try {
    await TableSession.updateOne(
      { _id: previous._id, status: 'closed' },
      {
        $set: {
          status: previous.status,
          isActive: true,
          closedAt: null,
          closeReason: null,
          closedBy: null,
        },
      },
    );
  } catch (err) {
    logger.error(`Không mở lại được phiên ${previous._id.toString()}: ${String(err)}`);
  }
}

/** Sau khi phiên đóng: bàn về available (nếu bàn không còn phiên khác), yêu cầu phục vụ → done. */
async function releaseTableAfterClose(
  session: LeanSession,
  closedBy: string,
  now: Date,
): Promise<TableRef> {
  const hasOther = await TableSession.exists({ tableId: session.tableId, isActive: true });
  const status: TableStatus = hasOther ? 'occupied' : 'available';
  const [table] = await Promise.all([
    Table.findByIdAndUpdate(
      session.tableId,
      { $set: { status } },
      { returnDocument: 'after', lean: true },
    ),
    resolveOpenRequestsOfSession(session._id, closedBy, now),
  ]);
  return {
    id: session.tableId.toString(),
    code: table?.code ?? '',
    status: table?.status ?? status,
  };
}

function toClosedInfo(session: LeanSession): ClosedSessionInfo {
  return {
    id: session._id.toString(),
    status: session.status,
    closeReason: session.closeReason ?? null,
    closedAt: session.closedAt ?? null,
  };
}

async function billableOrderIds(sessionId: Types.ObjectId): Promise<string[]> {
  const orders = await Order.find({ sessionId, status: { $in: BILLABLE_STATUSES } })
    .select('_id')
    .lean();
  return orders.map((order) => order._id.toString()).sort();
}

const describeOrders = (orders: BillOrderRef[]) =>
  orders.map((order) => `${order.orderNumber} (${order.status})`).join(', ');

// ------------------------------------------------------------------ Khách

export interface RequestBillResult {
  bill: Bill;
  serviceRequest: { id: string; type: 'request_bill'; status: string; createdAt: Date };
}

/**
 * Khách yêu cầu thanh toán: phiên → payment_requested (không gọi thêm món được nữa),
 * bàn → needs_payment, tạo (hoặc cập nhật) ServiceRequest request_bill. Gọi lại nhiều lần an toàn.
 */
export async function requestBill(
  ref: GuestSessionRef,
  input: RequestBillInput,
  now = new Date(),
): Promise<RequestBillResult> {
  const settings = await getSettings();
  if (input.preferredMethod && !settings.paymentMethods.includes(input.preferredMethod)) {
    throw new AppError(
      422,
      'PAYMENT_METHOD_UNAVAILABLE',
      'Nhà hàng chưa hỗ trợ phương thức thanh toán này',
      { paymentMethods: settings.paymentMethods },
    );
  }

  const current = await loadActiveSession(ref.id).catch(() => {
    throw new AppError(401, 'SESSION_CLOSED', 'Phiên bàn đã kết thúc, vui lòng quét lại mã QR');
  });
  const { bill: preview } = await computeBill(current);
  if (preview.items.length === 0) {
    throw new AppError(409, 'NOTHING_TO_PAY', 'Bàn chưa có món nào để thanh toán');
  }

  const set: Record<string, unknown> = { status: 'payment_requested' };
  if (!current.paymentRequestedAt) set.paymentRequestedAt = now;
  if (input.preferredMethod) set.preferredPaymentMethod = input.preferredMethod;
  const session = (await TableSession.findOneAndUpdate(
    { _id: current._id, isActive: true },
    { $set: set },
    { returnDocument: 'after', lean: true },
  )) as LeanSession | null;
  if (!session) {
    throw new AppError(401, 'SESSION_CLOSED', 'Phiên bàn đã kết thúc, vui lòng quét lại mã QR');
  }

  const [request] = await Promise.all([
    upsertBillRequest(session._id, session.tableId, input.preferredMethod),
    Table.updateOne({ _id: session.tableId }, { $set: { status: 'needs_payment' } }),
  ]);
  const { bill } = await computeBill(session);
  return {
    bill,
    serviceRequest: {
      id: request._id.toString(),
      type: 'request_bill',
      status: request.status,
      createdAt: request.createdAt,
    },
  };
}

/** Hoá đơn tạm tính cho khách. */
export async function getGuestBill(ref: GuestSessionRef): Promise<Bill> {
  const session = await loadActiveSession(ref.id).catch(() => {
    throw new AppError(401, 'SESSION_CLOSED', 'Phiên bàn đã kết thúc, vui lòng quét lại mã QR');
  });
  return (await computeBill(session)).bill;
}

// ------------------------------------------------------------------ Nhân viên: thu tiền

export interface RecordPaymentResult {
  payment: PaymentDto;
  session: ClosedSessionInfo;
  table: TableRef;
  /** Cảnh báo (vd. thu tiền khi còn đơn chưa xử lý xong — force). */
  warnings: string[];
}

/**
 * Ghi nhận thanh toán thủ công và đóng phiên:
 * kiểm tra đơn chưa xử lý (trừ khi force), tính tiền, tạo Payment, đóng phiên,
 * bàn → available, các yêu cầu phục vụ còn mở → done.
 */
export async function recordPayment(
  sessionId: string,
  input: RecordPaymentInput,
  cashierId: string,
  now = new Date(),
): Promise<RecordPaymentResult> {
  const session = await loadActiveSession(sessionId);
  const { bill, orderIds, settings } = await computeBill(session, input.discountAmount);
  const currency = settings.currency;

  if (bill.items.length === 0) {
    throw new AppError(
      409,
      'NOTHING_TO_PAY',
      'Phiên chưa có món nào để thanh toán — dùng "Huỷ phiên" để đóng bàn',
    );
  }

  const warnings: string[] = [];
  if (bill.unfinishedOrders.length > 0) {
    if (!input.force) {
      throw new AppError(
        409,
        'UNFINISHED_ORDERS',
        `Còn ${bill.unfinishedOrders.length} đơn chưa xử lý xong. Xử lý đơn hoặc gửi force=true để vẫn thu tiền.`,
        { unfinishedOrders: bill.unfinishedOrders },
      );
    }
    warnings.push(
      `Thu tiền khi còn ${bill.unfinishedOrders.length} đơn chưa xử lý xong: ${describeOrders(bill.unfinishedOrders)}`,
    );
  }

  if (roundMoney(input.discountAmount, currency) > bill.totalBeforeDiscount) {
    throw new AppError(422, 'INVALID_DISCOUNT', 'Số tiền giảm giá vượt quá tổng hoá đơn', {
      totalBeforeDiscount: bill.totalBeforeDiscount,
    });
  }

  const amountReceived = roundMoney(input.amountReceived ?? bill.total, currency);
  if (amountReceived < bill.total) {
    throw new AppError(422, 'INSUFFICIENT_AMOUNT', 'Số tiền nhận chưa đủ', {
      total: bill.total,
      amountReceived,
      missing: roundMoney(bill.total - amountReceived, currency),
    });
  }
  const change = roundMoney(amountReceived - bill.total, currency);

  // 1) Đóng phiên trước (nguyên tử) — từ đây token cũ không gọi món được nữa.
  const closed = await closeSessionAtomically(session._id, 'paid', cashierId, now);
  if (!closed) throw new AppError(409, 'SESSION_CLOSED', 'Phiên bàn đã được đóng/thanh toán');

  let payment;
  try {
    // 2) Khách đặt thêm/huỷ đơn trong lúc tính tiền → hoá đơn đã thay đổi, yêu cầu tính lại.
    const latest = await billableOrderIds(session._id);
    const billed = orderIds.map((id) => id.toString()).sort();
    if (latest.join() !== billed.join()) {
      throw new AppError(409, 'BILL_CHANGED', 'Hoá đơn vừa thay đổi, vui lòng tải lại và thử lại');
    }

    // 3) Ghi nhận thanh toán (unique sessionId chặn ghi trùng).
    const table = await Table.findById(session.tableId).select('code').lean();
    payment = await Payment.create({
      sessionId: session._id,
      tableId: session.tableId,
      tableCode: table?.code ?? bill.table.code,
      orderIds,
      currency,
      subtotal: bill.subtotal,
      serviceChargePercent: bill.serviceChargePercent,
      serviceCharge: bill.serviceCharge,
      vatPercent: bill.vatPercent,
      vat: bill.vatAmount,
      discount: bill.discountAmount,
      discountReason: bill.discountAmount > 0 ? input.discountReason : null,
      total: bill.total,
      method: input.method,
      amountReceived,
      change,
      note: input.note,
      forced: warnings.length > 0,
      warnings,
      paidAt: now,
      businessDate: toBusinessDate(now),
      cashierId,
    });
  } catch (err) {
    await reopenSession(session);
    if ((err as { code?: unknown }).code === 11000) {
      throw new AppError(409, 'SESSION_ALREADY_PAID', 'Phiên này đã được thanh toán');
    }
    throw err;
  }

  // 4) Giải phóng bàn + đóng các yêu cầu phục vụ.
  const tableRef = await releaseTableAfterClose(closed, cashierId, now);
  const [dto] = await toPaymentDtos([payment.toObject()]);
  return { payment: dto!, session: toClosedInfo(closed), table: tableRef, warnings };
}

// ------------------------------------------------------------------ Nhân viên: huỷ / chuyển bàn

export interface CancelSessionResult {
  session: ClosedSessionInfo;
  table: TableRef;
}

/** Huỷ phiên trống (không có món nào được tính tiền) — vd. khách quét nhầm / bỏ về. */
export async function cancelSession(
  sessionId: string,
  input: CancelSessionInput,
  userId: string,
  now = new Date(),
): Promise<CancelSessionResult> {
  const session = await loadActiveSession(sessionId);
  const assertEmpty = async () => {
    const { bill } = await computeBill(session);
    if (bill.items.length > 0) {
      throw new AppError(
        409,
        'SESSION_NOT_EMPTY',
        'Phiên đã có món — không thể huỷ, hãy thanh toán hoặc huỷ các đơn trước',
        { orders: bill.orders },
      );
    }
  };
  await assertEmpty();

  const closed = await closeSessionAtomically(session._id, 'cancelled', userId, now);
  if (!closed) throw new AppError(409, 'SESSION_CLOSED', 'Phiên bàn đã đóng');
  try {
    await assertEmpty(); // khách vừa đặt món trong lúc huỷ
    if (input.reason) {
      await TableSession.updateOne(
        { _id: closed._id },
        {
          $set: {
            note: closed.note ? `${closed.note}\n[Huỷ] ${input.reason}` : `[Huỷ] ${input.reason}`,
          },
        },
      );
    }
  } catch (err) {
    await reopenSession(session);
    throw err;
  }
  const table = await releaseTableAfterClose(closed, userId, now);
  return { session: toClosedInfo(closed), table };
}

export interface MoveSessionResult {
  session: { id: string; status: SessionStatus; tableId: string };
  fromTable: TableRef;
  toTable: TableRef;
}

/**
 * Chuyển phiên sang bàn khác (bàn đích phải đang hoạt động và trống).
 * Đơn và yêu cầu phục vụ đi theo phiên; token của khách vẫn dùng được.
 */
export async function moveSession(
  sessionId: string,
  input: MoveSessionInput,
): Promise<MoveSessionResult> {
  const session = await loadActiveSession(sessionId);
  const fromId = session.tableId;
  if (fromId.toString() === input.toTableId.toLowerCase()) {
    throw new AppError(400, 'SAME_TABLE', 'Bàn đích trùng với bàn hiện tại');
  }

  const target = await Table.findById(input.toTableId).select('isActive status').lean();
  if (!target) throw AppError.notFound('Không tìm thấy bàn đích');
  if (!target.isActive) {
    throw new AppError(409, 'TABLE_INACTIVE', 'Bàn đích đã ngừng sử dụng');
  }

  const targetStatus: TableStatus =
    session.status === 'payment_requested' ? 'needs_payment' : 'occupied';
  const notAvailable = () =>
    new AppError(409, 'TABLE_NOT_AVAILABLE', 'Bàn đích đang có khách hoặc không trống');

  // Giữ chỗ bàn đích nguyên tử: chỉ khi đang available.
  const claimed = await Table.findOneAndUpdate(
    { _id: target._id, isActive: true, status: 'available' },
    { $set: { status: targetStatus } },
    { returnDocument: 'after', lean: true },
  );
  if (!claimed) throw notAvailable();

  let moved: LeanSession | null;
  try {
    moved = (await TableSession.findOneAndUpdate(
      { _id: session._id, isActive: true, tableId: fromId },
      { $set: { tableId: target._id } },
      { returnDocument: 'after', lean: true },
    )) as LeanSession | null;
  } catch (err) {
    await Table.updateOne({ _id: target._id }, { $set: { status: 'available' } });
    // unique (tableId, isActive) — bàn đích vừa có phiên mới
    if ((err as { code?: unknown }).code === 11000) throw notAvailable();
    throw err;
  }
  if (!moved) {
    await Table.updateOne({ _id: target._id }, { $set: { status: 'available' } });
    throw new AppError(409, 'SESSION_CLOSED', 'Phiên bàn đã đóng hoặc vừa được chuyển');
  }

  await Promise.all([
    Order.updateMany({ sessionId: session._id }, { $set: { tableId: target._id } }),
    moveRequestsToTable(session._id, target._id),
  ]);
  const hasOther = await TableSession.exists({ tableId: fromId, isActive: true });
  const from = await Table.findByIdAndUpdate(
    fromId,
    { $set: { status: hasOther ? 'occupied' : 'available' } },
    { returnDocument: 'after', lean: true },
  );

  return {
    session: { id: moved._id.toString(), status: moved.status, tableId: target._id.toString() },
    fromTable: {
      id: fromId.toString(),
      code: from?.code ?? '',
      status: from?.status ?? 'available',
    },
    toTable: { id: claimed._id.toString(), code: claimed.code, status: claimed.status },
  };
}

// ------------------------------------------------------------------ Danh sách thanh toán

export interface PaymentSummary {
  count: number;
  total: number;
  byMethod: Record<PaymentMethod, { count: number; total: number }>;
}

export interface ListPaymentsResult {
  items: PaymentDto[];
  meta: PaginationMeta & { summary: PaymentSummary };
}

export async function listPayments(query: ListPaymentsQuery): Promise<ListPaymentsResult> {
  const filter: Record<string, unknown> = {};
  if (query.from || query.to) {
    filter.businessDate = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }
  if (query.method) filter.method = query.method;
  if (query.tableId) filter.tableId = new Types.ObjectId(query.tableId);

  const { page, limit, skip, sort } = getPaginationOptions(query, {
    allowedSortFields: ['paidAt', 'total', 'createdAt'],
    defaultSort: { paidAt: -1 },
  });
  const [payments, total, groups] = await Promise.all([
    Payment.find(filter)
      .sort({ ...sort, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<LeanPayment[]>(),
    Payment.countDocuments(filter),
    Payment.aggregate<{ _id: PaymentMethod; count: number; total: number }>([
      { $match: filter },
      { $group: { _id: '$method', count: { $sum: 1 }, total: { $sum: '$total' } } },
    ]),
  ]);

  const byMethod = {
    cash: { count: 0, total: 0 },
    bank_transfer: { count: 0, total: 0 },
    card: { count: 0, total: 0 },
  } as PaymentSummary['byMethod'];
  for (const group of groups) byMethod[group._id] = { count: group.count, total: group.total };

  return {
    items: await toPaymentDtos(payments),
    meta: {
      ...buildPaginationMeta(total, page, limit),
      summary: {
        count: groups.reduce((sum, g) => sum + g.count, 0),
        total: groups.reduce((sum, g) => sum + g.total, 0),
        byMethod,
      },
    },
  };
}

export async function getPayment(id: string): Promise<PaymentDto> {
  const payment = await Payment.findById(id).lean<LeanPayment>();
  if (!payment) throw AppError.notFound('Không tìm thấy thanh toán');
  const [dto] = await toPaymentDtos([payment]);
  return dto!;
}
