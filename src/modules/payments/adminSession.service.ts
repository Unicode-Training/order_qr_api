import { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import {
  buildPaginationMeta,
  getPaginationOptions,
  type PaginationMeta,
} from '../../utils/pagination';
import { addDays, zonedTimeToUtc } from '../../utils/zonedDate';
import { toAdminOrderDtos, type AdminOrderDto } from '../orders/adminOrder.service';
import { Order } from '../orders/order.model';
import { BILLABLE_STATUSES, type LeanOrder } from '../orders/order.service';
import {
  TableSession,
  type SessionCloseReason,
  type SessionStatus,
} from '../sessions/tableSession.model';
import { Table } from '../tables/table.model';
import { User } from '../users/user.model';
import { ADMIN_SESSION_SORT_FIELDS } from './adminSession.schema';
import type { ListAdminSessionsQuery, UpdateAdminSessionInput } from './adminSession.schema';
import { computeBill, type Bill, type LeanSession } from './bill.service';
import { Payment, type IPayment } from './payment.model';
import { toPaymentDtos, type PaymentDto } from './payment.service';

/** Mặc định chỉ liệt kê phiên chưa đóng. */
const OPEN_SESSION_STATUSES: SessionStatus[] = ['open', 'payment_requested'];

// ------------------------------------------------------------------ DTO

export interface AdminSessionDto {
  id: string;
  table: { id: string; code: string; name: string } | null;
  status: SessionStatus;
  guestCount: number | null;
  customerName: string | null;
  note: string | null;
  openedAt: Date;
  paymentRequestedAt: Date | null;
  preferredPaymentMethod: string | null;
  closedAt: Date | null;
  closeReason: SessionCloseReason | null;
  closedBy: { id: string; fullName: string | null } | null;
  /** Số đơn không bị huỷ. */
  orderCount: number;
  /** Tổng tiền món (trước phí/VAT) của các đơn không bị huỷ. */
  subtotal: number;
}

export interface AdminSessionDetail extends AdminSessionDto {
  /** Mọi đơn của phiên (kể cả đơn đã huỷ), cũ trước. */
  orders: AdminOrderDto[];
  /** Thanh toán của phiên (chỉ khi đã thu tiền). */
  payment: PaymentDto | null;
  /** Hoá đơn tạm tính — chỉ khi phiên chưa đóng. */
  bill: Bill | null;
}

interface SessionTotals {
  orderCount: number;
  subtotal: number;
}

/** Số đơn + subtotal (không tính đơn huỷ) của nhiều phiên trong một aggregation. */
async function loadSessionTotals(
  sessionIds: Types.ObjectId[],
): Promise<Map<string, SessionTotals>> {
  if (sessionIds.length === 0) return new Map();
  const rows = await Order.aggregate<{ _id: Types.ObjectId; orderCount: number; subtotal: number }>(
    [
      { $match: { sessionId: { $in: sessionIds }, status: { $in: BILLABLE_STATUSES } } },
      { $group: { _id: '$sessionId', orderCount: { $sum: 1 }, subtotal: { $sum: '$subtotal' } } },
    ],
  );
  return new Map(
    rows.map((row) => [row._id.toString(), { orderCount: row.orderCount, subtotal: row.subtotal }]),
  );
}

/** Chuyển nhiều phiên sang DTO — nạp bàn, nhân viên đóng phiên, tổng đơn theo lô (tránh N+1). */
async function toAdminSessionDtos(
  sessions: LeanSession[],
  totals?: Map<string, SessionTotals>,
): Promise<AdminSessionDto[]> {
  if (sessions.length === 0) return [];
  const tableIds = [...new Set(sessions.map((s) => s.tableId.toString()))];
  const userIds = [
    ...new Set(sessions.flatMap((s) => (s.closedBy ? [s.closedBy.toString()] : []))),
  ];
  const [tables, users, totalsBySession] = await Promise.all([
    Table.find({ _id: { $in: tableIds } })
      .select('code name')
      .lean(),
    userIds.length > 0
      ? User.find({ _id: { $in: userIds } })
          .select('fullName')
          .lean()
      : Promise.resolve([]),
    totals ? Promise.resolve(totals) : loadSessionTotals(sessions.map((s) => s._id)),
  ]);
  const tableById = new Map(
    tables.map((t) => [t._id.toString(), { id: t._id.toString(), code: t.code, name: t.name }]),
  );
  const userName = new Map(users.map((u) => [u._id.toString(), u.fullName]));

  return sessions.map((session) => {
    const sums = totalsBySession.get(session._id.toString());
    const closedBy = session.closedBy?.toString() ?? null;
    return {
      id: session._id.toString(),
      table: tableById.get(session.tableId.toString()) ?? null,
      status: session.status,
      guestCount: session.guestCount ?? null,
      customerName: session.customerName ?? null,
      note: session.note ?? null,
      openedAt: session.openedAt,
      paymentRequestedAt: session.paymentRequestedAt ?? null,
      preferredPaymentMethod: session.preferredPaymentMethod ?? null,
      closedAt: session.closedAt ?? null,
      closeReason: session.closeReason ?? null,
      closedBy: closedBy ? { id: closedBy, fullName: userName.get(closedBy) ?? null } : null,
      orderCount: sums?.orderCount ?? 0,
      subtotal: sums?.subtotal ?? 0,
    };
  });
}

// ------------------------------------------------------------------ Danh sách

export interface AdminSessionListResult {
  items: AdminSessionDto[];
  meta: PaginationMeta;
}

/** Bộ lọc Mongo cho danh sách phiên. Trả null nếu chắc chắn không có kết quả. */
async function buildFilter(query: ListAdminSessionsQuery): Promise<Record<string, unknown> | null> {
  const statuses = query.status ?? (query.closeReason ? ['closed'] : OPEN_SESSION_STATUSES);
  const filter: Record<string, unknown> = { status: { $in: statuses } };
  if (query.closeReason) filter.closeReason = query.closeReason;

  if (query.areaId) {
    const ids = (await Table.find({ areaId: query.areaId }).select('_id').lean()).map((t) =>
      t._id.toString(),
    );
    const allowed = query.tableId ? ids.filter((id) => id === query.tableId!.toLowerCase()) : ids;
    if (allowed.length === 0) return null;
    filter.tableId = { $in: allowed.map((id) => new Types.ObjectId(id)) };
  } else if (query.tableId) {
    filter.tableId = new Types.ObjectId(query.tableId);
  }

  if (query.from || query.to) {
    filter.openedAt = {
      ...(query.from ? { $gte: zonedTimeToUtc(query.from) } : {}),
      ...(query.to ? { $lt: zonedTimeToUtc(addDays(query.to, 1)) } : {}),
    };
  }
  return filter;
}

export async function listSessions(query: ListAdminSessionsQuery): Promise<AdminSessionListResult> {
  const { page, limit, skip, sort } = getPaginationOptions(query, {
    allowedSortFields: ADMIN_SESSION_SORT_FIELDS,
    defaultSort: { openedAt: -1 },
  });
  const filter = await buildFilter(query);
  if (!filter) return { items: [], meta: buildPaginationMeta(0, page, limit) };

  const [sessions, total] = await Promise.all([
    TableSession.find(filter)
      .sort({ ...sort, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<LeanSession[]>(),
    TableSession.countDocuments(filter),
  ]);
  return {
    items: await toAdminSessionDtos(sessions),
    meta: buildPaginationMeta(total, page, limit),
  };
}

// ------------------------------------------------------------------ Chi tiết & cập nhật

async function findSessionOrThrow(id: string): Promise<LeanSession> {
  const session = await TableSession.findById(id).lean<LeanSession>();
  if (!session) throw AppError.notFound('Không tìm thấy phiên bàn');
  return session;
}

export async function getSession(id: string): Promise<AdminSessionDetail> {
  const session = await findSessionOrThrow(id);
  const [orders, payment, bill] = await Promise.all([
    Order.find({ sessionId: session._id }).sort({ createdAt: 1, _id: 1 }).lean<LeanOrder[]>(),
    Payment.findOne({ sessionId: session._id }).lean<IPayment & { _id: Types.ObjectId }>(),
    session.status === 'closed' ? Promise.resolve(null) : computeBill(session).then((c) => c.bill),
  ]);

  // Tổng tính từ chính danh sách đơn vừa nạp → khớp với `orders`.
  const billable = orders.filter((order) => BILLABLE_STATUSES.includes(order.status));
  const totals = new Map([
    [
      session._id.toString(),
      {
        orderCount: billable.length,
        subtotal: billable.reduce((sum, order) => sum + order.subtotal, 0),
      },
    ],
  ]);
  const [[dto], orderDtos, paymentDtos] = await Promise.all([
    toAdminSessionDtos([session], totals),
    toAdminOrderDtos(orders),
    payment ? toPaymentDtos([payment]) : Promise.resolve([]),
  ]);
  return { ...dto!, orders: orderDtos, payment: paymentDtos[0] ?? null, bill };
}

/** Nhân viên sửa số khách / tên khách / ghi chú của phiên chưa đóng. Phiên đã đóng → 409. */
export async function updateSession(
  id: string,
  input: UpdateAdminSessionInput,
): Promise<AdminSessionDto> {
  const update = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  const session = await TableSession.findOneAndUpdate(
    { _id: id, isActive: true },
    { $set: update },
    { returnDocument: 'after', lean: true, runValidators: true },
  );
  if (!session) {
    await findSessionOrThrow(id);
    throw new AppError(409, 'SESSION_CLOSED', 'Phiên bàn đã đóng, không thể sửa');
  }
  const [dto] = await toAdminSessionDtos([session as LeanSession]);
  return dto!;
}
