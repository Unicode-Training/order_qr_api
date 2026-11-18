import { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import {
  buildPaginationMeta,
  getPaginationOptions,
  type PaginationMeta,
} from '../../utils/pagination';
import { escapeRegex } from '../../utils/slug';
import { Area } from '../areas/area.model';
import { MenuItem } from '../menu/menuItem.model';
import { ensureActiveSessionForTable } from '../sessions/session.service';
import { getSettings, type PricingConfig } from '../settings/settings.service';
import { Table } from '../tables/table.model';
import { User } from '../users/user.model';
import type {
  ListAdminOrdersQuery,
  OrderBoardQuery,
  StaffCreateOrderInput,
  UpdateOrderItemInput,
  UpdateOrderStatusInput,
} from './adminOrder.schema';
import { ADMIN_ORDER_SORT_FIELDS } from './adminOrder.schema';
import { Order, type IOrderItem, type IStatusHistoryEntry, type OrderStatus } from './order.model';
import {
  nextOrderNumber,
  priceOrderLines,
  pricingOf,
  toBusinessDate,
  toOrderDto,
  type LeanOrder,
  type OrderDto,
} from './order.service';
import {
  allowedNextStatuses,
  canTransition,
  canTransitionItem,
  statusesBefore,
} from './orderStatus';

// ------------------------------------------------------------------ DTO cho nhân viên

export interface AdminOrderTableDto {
  id: string;
  code: string;
  name: string;
  area: { id: string; name: string } | null;
}

export interface AdminStatusHistoryDto {
  status: OrderStatus;
  at: Date;
  by: 'guest' | 'staff' | 'system';
  /** Nhân viên thao tác (khi by = staff). */
  byUser: { id: string; fullName: string } | null;
  note: string | null;
}

export interface AdminOrderDto extends Omit<OrderDto, 'statusHistory'> {
  table: AdminOrderTableDto | null;
  /** Các trạng thái có thể chuyển tiếp theo state machine. */
  allowedNextStatuses: OrderStatus[];
  statusHistory: AdminStatusHistoryDto[];
}

/** Chuyển nhiều đơn sang DTO, nạp kèm bàn/khu vực/nhân viên theo lô (tránh N+1). */
async function toAdminOrderDtos(
  orders: LeanOrder[],
  pricing?: PricingConfig,
): Promise<AdminOrderDto[]> {
  if (orders.length === 0) return [];
  const tableIds = [...new Set(orders.map((o) => o.tableId.toString()))];
  const userIds = [
    ...new Set(
      orders.flatMap((o) =>
        o.statusHistory.flatMap((h) => (h.by.userId ? [h.by.userId.toString()] : [])),
      ),
    ),
  ];
  const [tables, users, config] = await Promise.all([
    Table.find({ _id: { $in: tableIds } })
      .select('code name areaId')
      .lean(),
    userIds.length > 0
      ? User.find({ _id: { $in: userIds } })
          .select('fullName')
          .lean()
      : Promise.resolve([]),
    pricing ? Promise.resolve(pricing) : getSettings().then(pricingOf),
  ]);
  const areaIds = [...new Set(tables.flatMap((t) => (t.areaId ? [t.areaId.toString()] : [])))];
  const areas =
    areaIds.length > 0
      ? await Area.find({ _id: { $in: areaIds } })
          .select('name')
          .lean()
      : [];

  const areaById = new Map(
    areas.map((a) => [a._id.toString(), { id: a._id.toString(), name: a.name }]),
  );
  const tableById = new Map(
    tables.map((t) => [
      t._id.toString(),
      {
        id: t._id.toString(),
        code: t.code,
        name: t.name,
        area: t.areaId ? (areaById.get(t.areaId.toString()) ?? null) : null,
      },
    ]),
  );
  const userById = new Map(
    users.map((u) => [u._id.toString(), { id: u._id.toString(), fullName: u.fullName }]),
  );

  return orders.map((order) => {
    const base = toOrderDto(order, config);
    return {
      ...base,
      table: tableById.get(order.tableId.toString()) ?? null,
      allowedNextStatuses: [...allowedNextStatuses(order.status)],
      statusHistory: order.statusHistory.map((entry) => ({
        status: entry.status,
        at: entry.at,
        by: entry.by.type,
        byUser: entry.by.userId
          ? (userById.get(entry.by.userId.toString()) ?? {
              id: entry.by.userId.toString(),
              fullName: '',
            })
          : null,
        note: entry.note ?? null,
      })),
    };
  });
}

async function toAdminOrderDto(order: LeanOrder): Promise<AdminOrderDto> {
  const [dto] = await toAdminOrderDtos([order]);
  return dto!;
}

const staffActor = (userId: string) => ({
  type: 'staff' as const,
  userId: new Types.ObjectId(userId),
});

// ------------------------------------------------------------------ Danh sách & board

/** Bộ lọc bàn/khu vực dùng chung cho list và board. Trả null nếu chắc chắn không có kết quả. */
async function buildTableFilter(
  tableId: string | undefined,
  areaId: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (!areaId) return tableId ? { tableId: new Types.ObjectId(tableId) } : {};
  const ids = (await Table.find({ areaId }).select('_id').lean()).map((t) => t._id.toString());
  const allowed = tableId ? ids.filter((id) => id === tableId.toLowerCase()) : ids;
  if (allowed.length === 0) return null;
  return { tableId: { $in: allowed.map((id) => new Types.ObjectId(id)) } };
}

export interface AdminOrderListResult {
  items: AdminOrderDto[];
  meta: PaginationMeta & { serverTime: Date };
}

export async function listOrders(query: ListAdminOrdersQuery): Promise<AdminOrderListResult> {
  const serverTime = new Date();
  const { page, limit, skip, sort } = getPaginationOptions(query, {
    allowedSortFields: ADMIN_ORDER_SORT_FIELDS,
    defaultSort: { createdAt: -1 },
  });

  const tableFilter = await buildTableFilter(query.tableId, query.areaId);
  if (!tableFilter) {
    return { items: [], meta: { ...buildPaginationMeta(0, page, limit), serverTime } };
  }
  const filter: Record<string, unknown> = { ...tableFilter };
  if (query.status) filter.status = { $in: query.status };
  if (query.dateFrom || query.dateTo) {
    filter.businessDate = {
      ...(query.dateFrom ? { $gte: query.dateFrom } : {}),
      ...(query.dateTo ? { $lte: query.dateTo } : {}),
    };
  }
  if (query.search) filter.orderNumber = new RegExp(escapeRegex(query.search), 'i');
  if (query.updatedSince) filter.updatedAt = { $gt: query.updatedSince };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ ...sort, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<LeanOrder[]>(),
    Order.countDocuments(filter),
  ]);
  return {
    items: await toAdminOrderDtos(orders),
    meta: { ...buildPaginationMeta(total, page, limit), serverTime },
  };
}

export const BOARD_COLUMNS = ['pending', 'confirmed', 'preparing', 'ready', 'served'] as const;
type BoardColumnStatus = (typeof BOARD_COLUMNS)[number];

export interface OrderBoard {
  date: string;
  serverTime: Date;
  columns: { status: BoardColumnStatus; count: number; orders: AdminOrderDto[] }[];
  counts: Record<BoardColumnStatus | 'cancelled' | 'total', number>;
}

/**
 * Bảng điều phối Live Orders: đơn của một ngày kinh doanh gom theo cột trạng thái.
 * Cột đang xử lý sắp đơn cũ nhất lên đầu; cột served sắp đơn vừa phục vụ lên đầu.
 * Đơn huỷ không có cột riêng, chỉ có số đếm.
 */
export async function getOrderBoard(query: OrderBoardQuery, now = new Date()): Promise<OrderBoard> {
  const serverTime = new Date();
  const date = query.date ?? toBusinessDate(now);
  const counts: OrderBoard['counts'] = {
    pending: 0,
    confirmed: 0,
    preparing: 0,
    ready: 0,
    served: 0,
    cancelled: 0,
    total: 0,
  };

  const tableFilter = await buildTableFilter(query.tableId, query.areaId);
  const orders = tableFilter
    ? await Order.find({ businessDate: date, ...tableFilter })
        .sort({ createdAt: 1, _id: 1 })
        .lean<LeanOrder[]>()
    : [];
  const dtos = await toAdminOrderDtos(orders);

  const byStatus = new Map<BoardColumnStatus, AdminOrderDto[]>(BOARD_COLUMNS.map((s) => [s, []]));
  for (const dto of dtos) {
    counts[dto.status] += 1;
    counts.total += 1;
    byStatus.get(dto.status as BoardColumnStatus)?.push(dto);
  }
  byStatus.get('served')!.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  return {
    date,
    serverTime,
    columns: BOARD_COLUMNS.map((status) => ({
      status,
      count: counts[status],
      orders: byStatus.get(status)!,
    })),
    counts,
  };
}

export async function getOrder(id: string): Promise<AdminOrderDto> {
  const order = await Order.findById(id).lean<LeanOrder>();
  if (!order) throw AppError.notFound('Không tìm thấy đơn');
  return toAdminOrderDto(order);
}

// ------------------------------------------------------------------ Chuyển trạng thái đơn

function invalidTransition(from: OrderStatus, to: OrderStatus): AppError {
  return new AppError(
    409,
    'INVALID_STATUS_TRANSITION',
    `Không thể chuyển đơn từ "${from}" sang "${to}"`,
    { from, to, allowed: allowedNextStatuses(from) },
  );
}

/**
 * Nhân viên chuyển trạng thái đơn theo state machine; ghi statusHistory kèm người thao tác.
 * Món chưa huỷ được kéo theo trạng thái mới (không lùi món đã đi trước); huỷ đơn → huỷ mọi món.
 * Cập nhật có điều kiện theo trạng thái cũ nên hai nhân viên bấm cùng lúc chỉ một người thành công.
 */
export async function updateOrderStatus(
  id: string,
  input: UpdateOrderStatusInput,
  userId: string,
): Promise<AdminOrderDto> {
  const current = await Order.findById(id).select('status').lean();
  if (!current) throw AppError.notFound('Không tìm thấy đơn');
  const from = current.status;
  const to = input.status;
  if (!canTransition(from, to)) throw invalidTransition(from, to);

  const itemFilter =
    to === 'cancelled'
      ? { 'i.itemStatus': { $ne: 'cancelled' } }
      : { 'i.itemStatus': { $in: statusesBefore(to) } };

  const updated = await Order.findOneAndUpdate(
    { _id: id, status: from },
    {
      $set: { status: to, 'items.$[i].itemStatus': to },
      $push: {
        statusHistory: { status: to, at: new Date(), by: staffActor(userId), note: input.reason },
      },
    },
    { returnDocument: 'after', lean: true, arrayFilters: [itemFilter] },
  );
  if (!updated) {
    const latest = await Order.findById(id).select('status').lean();
    if (!latest) throw AppError.notFound('Không tìm thấy đơn');
    throw invalidTransition(latest.status, to);
  }
  return toAdminOrderDto(updated as LeanOrder);
}

// ------------------------------------------------------------------ Cập nhật từng món

const MAX_UPDATE_ATTEMPTS = 3;

/**
 * Cập nhật trạng thái một món, hoặc huỷ món / đánh dấu hết món rồi tính lại subtotal.
 * - Đơn đã served/cancelled → 409 ORDER_CLOSED.
 * - Đơn còn pending chỉ được huỷ món (chưa xác nhận thì chưa chế biến) → 409 ORDER_NOT_CONFIRMED.
 * - Món chỉ tiến lên (preparing → ready → served) hoặc bị huỷ khi chưa served.
 * - markSoldOut: huỷ món (lý do mặc định "Hết món") + đặt MenuItem.isAvailable=false.
 * - Huỷ hết mọi món → đơn tự chuyển cancelled.
 * Ghi bằng điều kiện updatedAt (optimistic lock), thử lại tối đa 3 lần nếu bị ghi chồng.
 */
export async function updateOrderItem(
  orderId: string,
  itemId: string,
  input: UpdateOrderItemInput,
  userId: string,
): Promise<AdminOrderDto> {
  const target = input.markSoldOut ? 'cancelled' : input.itemStatus!;

  for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt += 1) {
    const order = await Order.findById(orderId).lean<LeanOrder>();
    if (!order) throw AppError.notFound('Không tìm thấy đơn');
    const item = order.items.find((i) => i._id.toString() === itemId.toLowerCase());
    if (!item) throw AppError.notFound('Không tìm thấy món trong đơn');

    if (order.status === 'served' || order.status === 'cancelled') {
      throw new AppError(409, 'ORDER_CLOSED', 'Đơn đã kết thúc, không thể cập nhật món', {
        status: order.status,
      });
    }
    if (target !== 'cancelled' && order.status === 'pending') {
      throw new AppError(409, 'ORDER_NOT_CONFIRMED', 'Cần xác nhận đơn trước khi cập nhật món');
    }
    if (!canTransitionItem(item.itemStatus, target)) {
      throw new AppError(
        409,
        'INVALID_ITEM_STATUS_TRANSITION',
        `Không thể chuyển món từ "${item.itemStatus}" sang "${target}"`,
        { from: item.itemStatus, to: target },
      );
    }

    const items: IOrderItem[] = order.items.map((line) =>
      line._id.equals(item._id)
        ? {
            ...line,
            itemStatus: target,
            cancelReason:
              target === 'cancelled' ? (input.reason ?? 'Hết món') : (line.cancelReason ?? null),
          }
        : line,
    );
    const remaining = items.filter((line) => line.itemStatus !== 'cancelled');
    const subtotal = remaining.reduce((sum, line) => sum + line.lineTotal, 0);

    const update: Record<string, unknown> = { $set: { items, subtotal } };
    if (remaining.length === 0) {
      const entry: IStatusHistoryEntry = {
        status: 'cancelled',
        at: new Date(),
        by: staffActor(userId),
        note: 'Tất cả món trong đơn đã bị huỷ',
      };
      update.$set = { items, subtotal, status: 'cancelled' };
      update.$push = { statusHistory: entry };
    }

    const result = await Order.findOneAndUpdate(
      { _id: orderId, updatedAt: order.updatedAt, status: order.status },
      update,
      { returnDocument: 'after', lean: true },
    );
    if (!result) continue;

    if (input.markSoldOut) {
      await MenuItem.updateOne({ _id: item.menuItemId }, { $set: { isAvailable: false } });
    }
    return toAdminOrderDto(result as LeanOrder);
  }

  throw new AppError(
    409,
    'CONCURRENT_UPDATE',
    'Đơn vừa được cập nhật bởi người khác, vui lòng thử lại',
  );
}

// ------------------------------------------------------------------ Nhân viên tạo đơn thay khách

export interface StaffCreateOrderResult {
  order: AdminOrderDto;
  /** true nếu bàn chưa có phiên và hệ thống vừa tự mở phiên mới. */
  sessionCreated: boolean;
}

/**
 * Nhân viên tạo đơn cho một bàn: tự mở phiên nếu bàn chưa có.
 * Không bị chặn bởi giờ mở cửa / tắt đặt món qua QR (các cài đặt đó dành cho khách),
 * nhưng vẫn kiểm tra món còn bán và giới hạn số lượng. Đơn tạo ra đã ở trạng thái confirmed.
 */
export async function createOrderForTable(
  tableId: string,
  input: StaffCreateOrderInput,
  userId: string,
): Promise<StaffCreateOrderResult> {
  const settings = await getSettings();
  // Kiểm tra giỏ hàng trước để không mở phiên thừa khi đơn không hợp lệ.
  const { lines, subtotal } = await priceOrderLines(
    input.items,
    settings.ordering.maxItemQuantityPerOrder,
  );

  const { session, isNew } = await ensureActiveSessionForTable(tableId);
  if (session.status !== 'open') {
    throw new AppError(
      409,
      'SESSION_NOT_OPEN',
      'Bàn đã yêu cầu thanh toán, không thể gọi thêm món',
    );
  }

  const now = new Date();
  const actor = staffActor(userId);
  const businessDate = toBusinessDate(now);
  const order = await Order.create({
    orderNumber: await nextOrderNumber(businessDate),
    businessDate,
    sessionId: session.id,
    tableId: session.tableId,
    items: lines.map((line) => ({ ...line, itemStatus: 'confirmed' })),
    note: input.note,
    status: 'confirmed',
    subtotal,
    statusHistory: [
      { status: 'pending', at: now, by: actor, note: 'Nhân viên tạo đơn' },
      { status: 'confirmed', at: now, by: actor, note: null },
    ],
  });
  return {
    order: (await toAdminOrderDtos([order.toObject() as LeanOrder], pricingOf(settings)))[0]!,
    sessionCreated: isNew,
  };
}
