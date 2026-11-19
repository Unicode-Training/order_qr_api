import { Types } from 'mongoose';
import { env } from '../../config/env';
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
import {
  COUNTED_PAYMENT_FILTER,
  Payment,
  type IPayment,
  type PaymentStatus,
} from './payment.model';
import type {
  CancelSessionInput,
  ListPaymentsQuery,
  MoveSessionInput,
  RecordPaymentInput,
  RequestBillInput,
  VoidPaymentInput,
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
  status: PaymentStatus;
  voidedAt: Date | null;
  voidedBy: { id: string; fullName: string | null } | null;
  voidReason: string | null;
  createdAt: Date;
}

function toPaymentDto(payment: LeanPayment, names: Map<string, string>): PaymentDto {
  const voidedBy = payment.voidedBy?.toString() ?? null;
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
    cashier: {
      id: payment.cashierId.toString(),
      fullName: names.get(payment.cashierId.toString()) ?? null,
    },
    status: payment.status ?? 'completed',
    voidedAt: payment.voidedAt ?? null,
    voidedBy: voidedBy ? { id: voidedBy, fullName: names.get(voidedBy) ?? null } : null,
    voidReason: payment.voidReason ?? null,
    createdAt: payment.createdAt,
  };
}

export async function toPaymentDtos(payments: LeanPayment[]): Promise<PaymentDto[]> {
  const userIds = new Set<string>();
  for (const p of payments) {
    userIds.add(p.cashierId.toString());
    if (p.voidedBy) userIds.add(p.voidedBy.toString());
  }
  const users = await User.find({ _id: { $in: [...userIds] } })
    .select('fullName')
    .lean();
  const names = new Map(users.map((user) => [user._id.toString(), user.fullName]));
  return payments.map((p) => toPaymentDto(p, names));
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

/**
 * Đóng phiên nguyên tử (chỉ khi còn mở). Trả null nếu phiên đã bị đóng bởi request khác.
 * `extraFilter`: điều kiện thêm (vd. tự đóng chỉ khi phiên vẫn `open` và chưa bị sửa).
 */
async function closeSessionAtomically(
  sessionId: Types.ObjectId,
  reason: SessionCloseReason,
  closedBy: string | null,
  now: Date,
  extraFilter: Record<string, unknown> = {},
): Promise<LeanSession | null> {
  // findOneAndUpdate không chạy hook pre('validate') → tự đặt isActive=false.
  return TableSession.findOneAndUpdate(
    { ...extraFilter, _id: sessionId, isActive: true },
    {
      $set: {
        status: 'closed',
        isActive: false,
        closedAt: now,
        closeReason: reason,
        closedBy: closedBy ? new Types.ObjectId(closedBy) : null,
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
  closedBy: string | null,
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

  // Cùng quy tắc với requestBill: chỉ nhận phương thức nhà hàng đang bật (kiểm tra trước khi đóng phiên).
  if (!settings.paymentMethods.includes(input.method)) {
    throw new AppError(
      422,
      'PAYMENT_METHOD_UNAVAILABLE',
      'Nhà hàng chưa hỗ trợ phương thức thanh toán này',
      { paymentMethods: settings.paymentMethods },
    );
  }

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

// ------------------------------------------------------------------ Hệ thống: tự đóng phiên trống

export interface ExpireEmptySessionsResult {
  /** Id các phiên vừa được đóng với closeReason = expired. */
  expired: string[];
}

/** Phiên có đơn nào chưa huỷ không (đơn huỷ không tính là "có món"). */
const hasLiveOrders = (sessionId: Types.ObjectId) =>
  Order.exists({ sessionId, status: { $ne: 'cancelled' } });

/**
 * Tự đóng các phiên trống bị bỏ quên (khách quét QR rồi bỏ đi): phiên `open` (không đụng
 * `payment_requested`) không có đơn nào khác `cancelled`, và hoạt động cuối cùng — `openedAt`,
 * `updatedAt` của phiên và của mọi đơn (kể cả đơn đã huỷ) — cũ hơn `timeoutMinutes`.
 * Dùng lại quy trình của `cancelSession`: đóng nguyên tử (closeReason `expired`, closedBy null),
 * kiểm tra lại không có đơn sau khi đóng (khách vừa đặt món → mở lại), bàn → available,
 * yêu cầu nhanh còn mở → done. `timeoutMinutes <= 0` → không làm gì.
 * Lỗi của từng phiên chỉ được log, không chặn các phiên khác.
 */
export async function expireEmptySessions(
  now = new Date(),
  timeoutMinutes = env.EMPTY_SESSION_TIMEOUT_MINUTES,
): Promise<ExpireEmptySessionsResult> {
  const expired: string[] = [];
  if (timeoutMinutes <= 0) return { expired };
  const cutoff = new Date(now.getTime() - timeoutMinutes * 60_000);

  const candidates = await TableSession.find({
    status: 'open',
    isActive: true,
    openedAt: { $lt: cutoff },
    updatedAt: { $lt: cutoff },
  })
    .sort({ openedAt: 1 })
    .lean<LeanSession[]>();

  for (const session of candidates) {
    try {
      const [liveOrder, recentOrder] = await Promise.all([
        hasLiveOrders(session._id),
        Order.exists({ sessionId: session._id, updatedAt: { $gte: cutoff } }),
      ]);
      if (liveOrder || recentOrder) continue;

      // Chỉ đóng khi phiên vẫn y như lúc đọc (chưa yêu cầu thanh toán / chưa được sửa).
      const closed = await closeSessionAtomically(session._id, 'expired', null, now, {
        status: 'open',
        updatedAt: session.updatedAt,
      });
      if (!closed) continue;
      if (await hasLiveOrders(session._id)) {
        await reopenSession(session); // khách vừa đặt món trong lúc đóng
        continue;
      }
      await releaseTableAfterClose(closed, null, now);
      expired.push(closed._id.toString());
    } catch (err) {
      logger.error(`Không tự đóng được phiên trống ${session._id.toString()}: ${String(err)}`);
    }
  }
  if (expired.length > 0) {
    logger.info(`Đã tự đóng ${expired.length} phiên trống quá ${timeoutMinutes} phút`);
  }
  return { expired };
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
  if (query.status === 'completed') Object.assign(filter, COUNTED_PAYMENT_FILTER);
  else if (query.status === 'voided') filter.status = 'voided';
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

// ------------------------------------------------------------------ Huỷ (void) thanh toán ghi nhầm

export interface VoidPaymentResult {
  payment: PaymentDto;
  /** Phiên sau khi mở lại (null nếu reopenSession=false). */
  session: { id: string; status: SessionStatus } | null;
  /** Bàn sau khi mở lại phiên (null nếu reopenSession=false). */
  table: TableRef | null;
}

/**
 * Huỷ thanh toán ghi nhầm (sai số tiền / phương thức / bàn). Bản ghi giữ lại với status=voided
 * và không còn được tính vào doanh thu. Mặc định mở lại phiên (→ payment_requested, bàn → needs_payment)
 * để thu ngân thu lại với thông tin đúng; chỉ mở lại khi bàn chưa có phiên khác đang mở.
 */
export async function voidPayment(
  id: string,
  input: VoidPaymentInput,
  userId: string,
  now = new Date(),
): Promise<VoidPaymentResult> {
  const current = await Payment.findById(id).lean<LeanPayment>();
  if (!current) throw AppError.notFound('Không tìm thấy thanh toán');
  const alreadyVoided = () =>
    new AppError(409, 'PAYMENT_ALREADY_VOIDED', 'Thanh toán này đã được huỷ trước đó');
  if (current.status === 'voided') throw alreadyVoided();

  // Kiểm tra sớm (trước khi void) để trả lỗi rõ ràng; bước mở lại phiên vẫn được unique index bảo vệ.
  let previous: LeanSession | null = null;
  if (input.reopenSession) {
    previous = (await TableSession.findById(current.sessionId).lean()) as LeanSession | null;
    if (!previous) {
      throw new AppError(409, 'SESSION_NOT_FOUND', 'Không tìm thấy phiên của thanh toán này');
    }
    if (previous.status !== 'closed') {
      // Không xảy ra trong luồng bình thường (thanh toán luôn đóng phiên) — phòng dữ liệu lệch.
      throw new AppError(409, 'SESSION_NOT_CLOSED', 'Phiên của thanh toán này vẫn đang mở');
    }
    await assertTableFree(previous.tableId);
  }

  // 1) Void có điều kiện — bấm 2 lần / 2 người cùng huỷ → chỉ một request thắng.
  const voided = await Payment.findOneAndUpdate(
    { _id: current._id, ...COUNTED_PAYMENT_FILTER },
    {
      $set: {
        status: 'voided',
        voidedAt: now,
        voidedBy: new Types.ObjectId(userId),
        voidReason: input.reason,
      },
    },
    { returnDocument: 'after', lean: true },
  ).lean<LeanPayment>();
  if (!voided) throw alreadyVoided();

  if (!previous) {
    const [dto] = await toPaymentDtos([voided]);
    return { payment: dto!, session: null, table: null };
  }

  // 2) Mở lại phiên (unique (tableId, isActive) chặn khi khách vừa quét QR mở phiên mới).
  let reopened: LeanSession | null = null;
  try {
    reopened = (await TableSession.findOneAndUpdate(
      { _id: previous._id, status: 'closed' },
      {
        $set: {
          status: 'payment_requested',
          isActive: true,
          closedAt: null,
          closeReason: null,
          closedBy: null,
          paymentRequestedAt: previous.paymentRequestedAt ?? now,
        },
      },
      { returnDocument: 'after', lean: true },
    )) as LeanSession | null;
    if (!reopened) {
      throw new AppError(409, 'SESSION_NOT_CLOSED', 'Phiên của thanh toán này vừa thay đổi');
    }
    // 3) Bàn → needs_payment.
    const table = await Table.findByIdAndUpdate(
      reopened.tableId,
      { $set: { status: 'needs_payment', reservationNote: null } },
      { returnDocument: 'after', lean: true },
    );
    const [dto] = await toPaymentDtos([voided]);
    return {
      payment: dto!,
      session: { id: reopened._id.toString(), status: reopened.status },
      table: {
        id: reopened.tableId.toString(),
        code: table?.code ?? voided.tableCode,
        status: table?.status ?? 'needs_payment',
      },
    };
  } catch (err) {
    // Hoàn tác best-effort: đóng lại phiên (nếu đã mở) rồi khôi phục thanh toán.
    if (reopened) await recloseSession(previous);
    await restorePayment(voided);
    if ((err as { code?: unknown }).code === 11000) throw tableHasActiveSession();
    throw err;
  }
}

const tableHasActiveSession = () =>
  new AppError(
    409,
    'TABLE_HAS_ACTIVE_SESSION',
    'Bàn đang có phiên khác — không thể mở lại phiên cũ. Gửi reopenSession=false để chỉ huỷ thanh toán.',
  );

async function assertTableFree(tableId: Types.ObjectId): Promise<void> {
  if (await TableSession.exists({ tableId, isActive: true })) throw tableHasActiveSession();
}

async function restorePayment(voided: LeanPayment): Promise<void> {
  try {
    await Payment.updateOne(
      { _id: voided._id, status: 'voided', voidedAt: voided.voidedAt },
      { $set: { status: 'completed', voidedAt: null, voidedBy: null, voidReason: null } },
    );
  } catch (err) {
    logger.error(`Không khôi phục được thanh toán ${voided._id.toString()}: ${String(err)}`);
  }
}

/** Hoàn tác mở lại phiên: đưa về đúng trạng thái đóng trước đó. */
async function recloseSession(previous: LeanSession): Promise<void> {
  try {
    await TableSession.updateOne(
      { _id: previous._id, isActive: true },
      {
        $set: {
          status: 'closed',
          isActive: false,
          closedAt: previous.closedAt,
          closeReason: previous.closeReason,
          closedBy: previous.closedBy,
          paymentRequestedAt: previous.paymentRequestedAt ?? null,
        },
      },
    );
  } catch (err) {
    logger.error(`Không đóng lại được phiên ${previous._id.toString()}: ${String(err)}`);
  }
}

export async function getPayment(id: string): Promise<PaymentDto> {
  const payment = await Payment.findById(id).lean<LeanPayment>();
  if (!payment) throw AppError.notFound('Không tìm thấy thanh toán');
  const [dto] = await toPaymentDtos([payment]);
  return dto!;
}
