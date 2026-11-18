import { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { RESTAURANT_TIMEZONE } from '../../utils/openingHours';
import { Category } from '../menu/category.model';
import { MenuItem, type IMenuItem } from '../menu/menuItem.model';
import {
  canOrderAt,
  getSettings,
  type AdminSettings,
  type PricingConfig,
} from '../settings/settings.service';
import {
  Order,
  OrderCounter,
  type ActorType,
  type IOrder,
  type IOrderItem,
  type ISelectedOptionSnapshot,
  type IStatusHistoryEntry,
  type OrderStatus,
} from './order.model';
import type {
  CancelOrderInput,
  CreateOrderInput,
  ListSessionOrdersQuery,
  OrderLineInput,
  QuoteOrderInput,
} from './order.schema';
import { calculateTotals, type PriceBreakdown } from './pricing';

/** Phiên bàn đã xác thực (do middleware requireGuestSession gắn vào req). */
export interface GuestSessionRef {
  id: string;
  tableId: string;
  status: 'open' | 'payment_requested' | 'closed';
}

/** Trạng thái đơn còn được tính tiền (không tính đơn đã huỷ). */
export const BILLABLE_STATUSES: OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'served',
];

// ------------------------------------------------------------------ Validate & tính giá

export type OrderLineIssueCode =
  'ITEM_NOT_FOUND' | 'ITEM_UNAVAILABLE' | 'INVALID_OPTIONS' | 'QUANTITY_EXCEEDED';

export interface OrderLineIssue {
  /** Vị trí dòng trong mảng items gửi lên. */
  index: number;
  menuItemId: string;
  code: OrderLineIssueCode;
  message: string;
}

export interface PricedLine {
  menuItemId: Types.ObjectId;
  nameSnapshot: string;
  priceSnapshot: number;
  quantity: number;
  selectedOptions: ISelectedOptionSnapshot[];
  unitPrice: number;
  lineTotal: number;
  note: string | null;
}

type LeanMenuItem = IMenuItem & { _id: Types.ObjectId };

/** Chọn lựa chọn theo id; trả lỗi (string) nếu không hợp lệ với optionGroups của món. */
function resolveOptions(
  item: LeanMenuItem,
  optionIds: readonly string[],
): ISelectedOptionSnapshot[] | string {
  const wanted = new Set(optionIds.map((id) => id.toLowerCase()));
  const selected: ISelectedOptionSnapshot[] = [];

  for (const group of item.optionGroups ?? []) {
    const picked = group.options.filter((option) => wanted.has(option._id.toString()));
    if (group.required && picked.length === 0) {
      return `Vui lòng chọn "${group.name}"`;
    }
    if (picked.length > group.maxSelect) {
      return `"${group.name}" chỉ được chọn tối đa ${group.maxSelect}`;
    }
    for (const option of picked) {
      wanted.delete(option._id.toString());
      selected.push({
        groupId: group._id,
        groupName: group.name,
        optionId: option._id,
        optionName: option.name,
        priceDelta: option.priceDelta ?? 0,
      });
    }
  }

  if (wanted.size > 0) return 'Lựa chọn không thuộc món này';
  return selected;
}

/**
 * Kiểm tra giỏ hàng và tính giá — giá luôn lấy từ DB, không tin client.
 * Gom MỌI lỗi theo từng dòng rồi ném 422 ORDER_ITEMS_INVALID (details = OrderLineIssue[]).
 */
export async function priceOrderLines(
  lines: readonly OrderLineInput[],
  maxQuantityPerItem: number,
): Promise<{ lines: PricedLine[]; subtotal: number }> {
  const ids = [...new Set(lines.map((line) => line.menuItemId.toLowerCase()))];
  const items = await MenuItem.find({ _id: { $in: ids }, isActive: true })
    .select('name price isAvailable isActive categoryId optionGroups')
    .lean<LeanMenuItem[]>();
  const activeCategoryIds = new Set(
    (
      await Category.find({ _id: { $in: items.map((i) => i.categoryId) }, isActive: true })
        .select('_id')
        .lean()
    ).map((c) => c._id.toString()),
  );
  const itemById = new Map(
    items
      .filter((item) => activeCategoryIds.has(item.categoryId.toString()))
      .map((item) => [item._id.toString(), item]),
  );

  const issues: OrderLineIssue[] = [];
  const priced: PricedLine[] = [];
  const quantityByItem = new Map<string, number>();

  lines.forEach((line, index) => {
    const id = line.menuItemId.toLowerCase();
    const item = itemById.get(id);
    const issue = (code: OrderLineIssueCode, message: string) =>
      issues.push({ index, menuItemId: id, code, message });

    if (!item) return issue('ITEM_NOT_FOUND', 'Món không tồn tại hoặc đã ngừng bán');
    if (!item.isAvailable) return issue('ITEM_UNAVAILABLE', `"${item.name}" đã hết`);

    const options = resolveOptions(item, line.optionIds);
    if (typeof options === 'string') return issue('INVALID_OPTIONS', options);

    quantityByItem.set(id, (quantityByItem.get(id) ?? 0) + line.quantity);
    const unitPrice = item.price + options.reduce((sum, option) => sum + option.priceDelta, 0);
    priced.push({
      menuItemId: item._id,
      nameSnapshot: item.name,
      priceSnapshot: item.price,
      quantity: line.quantity,
      selectedOptions: options,
      unitPrice: Math.max(0, unitPrice),
      lineTotal: Math.max(0, unitPrice) * line.quantity,
      note: line.note,
    });
  });

  // Giới hạn số lượng tính theo tổng của cùng một món trong đơn (có thể nằm ở nhiều dòng).
  for (const [id, quantity] of quantityByItem) {
    if (quantity <= maxQuantityPerItem) continue;
    const index = lines.findIndex((line) => line.menuItemId.toLowerCase() === id);
    issues.push({
      index,
      menuItemId: id,
      code: 'QUANTITY_EXCEEDED',
      message: `"${itemById.get(id)?.name}" tối đa ${maxQuantityPerItem} phần mỗi đơn`,
    });
  }

  if (issues.length > 0) {
    issues.sort((a, b) => a.index - b.index);
    throw new AppError(
      422,
      'ORDER_ITEMS_INVALID',
      issues.length === 1 ? issues[0]!.message : 'Một số món trong giỏ hàng không hợp lệ',
      issues,
    );
  }

  return { lines: priced, subtotal: priced.reduce((sum, line) => sum + line.lineTotal, 0) };
}

export function pricingOf(settings: AdminSettings): PricingConfig {
  return {
    currency: settings.currency,
    vatPercent: settings.vatPercent,
    serviceChargePercent: settings.serviceChargePercent,
  };
}

// ------------------------------------------------------------------ DTO

interface PricedLineDto {
  menuItemId: string;
  nameSnapshot: string;
  priceSnapshot: number;
  quantity: number;
  selectedOptions: {
    groupId: string;
    groupName: string;
    optionId: string;
    optionName: string;
    priceDelta: number;
  }[];
  unitPrice: number;
  lineTotal: number;
  note: string | null;
}

export interface OrderItemDto extends PricedLineDto {
  id: string;
  itemStatus: OrderStatus;
  cancelReason: string | null;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  businessDate: string;
  sessionId: string;
  tableId: string;
  status: OrderStatus;
  /** Khách chỉ huỷ được khi đơn còn pending. */
  canCancel: boolean;
  items: OrderItemDto[];
  note: string | null;
  subtotal: number;
  /** Tạm tính theo VAT/phí phục vụ hiện tại. */
  totals: PriceBreakdown;
  statusHistory: { status: OrderStatus; at: Date; by: ActorType; note: string | null }[];
  createdAt: Date;
  updatedAt: Date;
}

function toLineDto(line: PricedLine): PricedLineDto {
  return {
    menuItemId: line.menuItemId.toString(),
    nameSnapshot: line.nameSnapshot,
    priceSnapshot: line.priceSnapshot,
    quantity: line.quantity,
    selectedOptions: line.selectedOptions.map((option) => ({
      groupId: option.groupId.toString(),
      groupName: option.groupName,
      optionId: option.optionId.toString(),
      optionName: option.optionName,
      priceDelta: option.priceDelta,
    })),
    unitPrice: line.unitPrice,
    lineTotal: line.lineTotal,
    note: line.note ?? null,
  };
}

export type LeanOrder = IOrder & { _id: Types.ObjectId };

export function toOrderDto(order: LeanOrder, pricing: PricingConfig): OrderDto {
  return {
    id: order._id.toString(),
    orderNumber: order.orderNumber,
    businessDate: order.businessDate,
    sessionId: order.sessionId.toString(),
    tableId: order.tableId.toString(),
    status: order.status,
    canCancel: order.status === 'pending',
    items: order.items.map((item: IOrderItem) => ({
      id: item._id.toString(),
      ...toLineDto(item),
      itemStatus: item.itemStatus,
      cancelReason: item.cancelReason ?? null,
    })),
    note: order.note ?? null,
    subtotal: order.subtotal,
    totals: calculateTotals(order.status === 'cancelled' ? 0 : order.subtotal, pricing),
    statusHistory: order.statusHistory.map((entry) => ({
      status: entry.status,
      at: entry.at,
      by: entry.by.type,
      note: entry.note ?? null,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

// ------------------------------------------------------------------ Quote & đặt món

export interface OrderQuote extends PriceBreakdown {
  items: PricedLineDto[];
  /** Nhà hàng có đang nhận đơn không (bật đặt món + trong giờ mở cửa hoặc cho phép ngoài giờ). */
  canOrderNow: boolean;
  maxItemQuantityPerOrder: number;
}

/** Tạm tính giỏ hàng (không lưu gì). */
export async function quoteOrder(input: QuoteOrderInput, now = new Date()): Promise<OrderQuote> {
  const settings = await getSettings();
  const { lines, subtotal } = await priceOrderLines(
    input.items,
    settings.ordering.maxItemQuantityPerOrder,
  );
  return {
    items: lines.map(toLineDto),
    ...calculateTotals(subtotal, pricingOf(settings)),
    canOrderNow: canOrderAt(settings, now),
    maxItemQuantityPerOrder: settings.ordering.maxItemQuantityPerOrder,
  };
}

const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: RESTAURANT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Ngày kinh doanh YYYY-MM-DD theo múi giờ nhà hàng. */
export function toBusinessDate(date: Date): string {
  return businessDateFormatter.format(date);
}

/** Cấp số đơn tiếp theo của ngày: ORD-0001, ORD-0002, ... (an toàn khi đặt đồng thời). */
export async function nextOrderNumber(businessDate: string): Promise<string> {
  const counter = await OrderCounter.findOneAndUpdate(
    { key: businessDate },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  return `ORD-${String(counter!.seq).padStart(4, '0')}`;
}

function assertCanOrder(settings: AdminSettings, session: GuestSessionRef, now: Date): void {
  if (session.status !== 'open') {
    throw new AppError(
      409,
      'SESSION_NOT_OPEN',
      'Bàn đã yêu cầu thanh toán, không thể gọi thêm món. Vui lòng liên hệ nhân viên.',
    );
  }
  if (!settings.ordering.enabled) {
    throw new AppError(409, 'ORDERING_DISABLED', 'Nhà hàng tạm ngừng nhận đơn qua QR');
  }
  if (!canOrderAt(settings, now)) {
    throw new AppError(409, 'RESTAURANT_CLOSED', 'Nhà hàng hiện ngoài giờ nhận đơn');
  }
}

/** Đặt món: validate, chụp lại tên/giá/lựa chọn, tạo đơn pending (hoặc confirmed nếu không cần xác nhận). */
export async function createOrder(
  session: GuestSessionRef,
  input: CreateOrderInput,
  now = new Date(),
): Promise<OrderDto> {
  const settings = await getSettings();
  assertCanOrder(settings, session, now);
  const { lines, subtotal } = await priceOrderLines(
    input.items,
    settings.ordering.maxItemQuantityPerOrder,
  );

  const autoConfirm = !settings.ordering.requireStaffConfirm;
  const status: OrderStatus = autoConfirm ? 'confirmed' : 'pending';
  const statusHistory: IStatusHistoryEntry[] = [
    { status: 'pending', at: now, by: { type: 'guest', userId: null }, note: null },
  ];
  if (autoConfirm) {
    statusHistory.push({
      status: 'confirmed',
      at: now,
      by: { type: 'system', userId: null },
      note: 'Tự động xác nhận',
    });
  }

  const businessDate = toBusinessDate(now);
  const order = await Order.create({
    orderNumber: await nextOrderNumber(businessDate),
    businessDate,
    sessionId: session.id,
    tableId: session.tableId,
    items: lines.map((line) => ({ ...line, itemStatus: status })),
    note: input.note,
    status,
    subtotal,
    statusHistory,
  });
  return toOrderDto(order.toObject(), pricingOf(settings));
}

// ------------------------------------------------------------------ Theo dõi & huỷ đơn

export interface SessionOrdersResult {
  items: OrderDto[];
  /** Thời điểm server — client gửi lại làm `updatedSince` ở lần polling sau. */
  serverTime: Date;
}

/** Đơn của phiên (mới nhất trước); `updatedSince` → chỉ đơn có thay đổi sau thời điểm đó. */
export async function listSessionOrders(
  session: GuestSessionRef,
  query: ListSessionOrdersQuery,
): Promise<SessionOrdersResult> {
  const serverTime = new Date();
  const filter: Record<string, unknown> = { sessionId: session.id };
  if (query.updatedSince) filter.updatedAt = { $gt: query.updatedSince };
  const [orders, settings] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1, _id: -1 }).lean<LeanOrder[]>(),
    getSettings(),
  ]);
  const pricing = pricingOf(settings);
  return { items: orders.map((order) => toOrderDto(order, pricing)), serverTime };
}

/** Khách huỷ đơn — chỉ khi đơn thuộc phiên và còn pending. */
export async function cancelOrderByGuest(
  session: GuestSessionRef,
  orderId: string,
  input: CancelOrderInput,
): Promise<OrderDto> {
  const now = new Date();
  const order = await Order.findOneAndUpdate(
    { _id: orderId, sessionId: session.id, status: 'pending' },
    {
      $set: { status: 'cancelled', 'items.$[].itemStatus': 'cancelled' },
      $push: {
        statusHistory: {
          status: 'cancelled',
          at: now,
          by: { type: 'guest', userId: null },
          note: input.reason,
        },
      },
    },
    { returnDocument: 'after', lean: true },
  );

  if (!order) {
    const existing = await Order.findOne({ _id: orderId, sessionId: session.id })
      .select('status')
      .lean();
    if (!existing) throw AppError.notFound('Không tìm thấy đơn');
    throw new AppError(
      409,
      'ORDER_NOT_CANCELLABLE',
      'Đơn đã được nhà hàng xác nhận, không thể huỷ. Vui lòng liên hệ nhân viên.',
      { status: existing.status },
    );
  }
  return toOrderDto(order as LeanOrder, pricingOf(await getSettings()));
}

export interface SessionBill extends PriceBreakdown {
  orderCount: number;
  /** Đơn chưa huỷ. */
  activeOrderCount: number;
  /** Tổng số phần món của các đơn chưa huỷ. */
  itemCount: number;
}

/** Tổng tạm tính của cả phiên (không tính đơn đã huỷ). */
export async function getSessionBill(sessionId: string): Promise<SessionBill> {
  const [rows, orderCount, settings] = await Promise.all([
    Order.aggregate<{ subtotal: number; activeOrderCount: number; itemCount: number }>([
      {
        $match: {
          sessionId: new Types.ObjectId(sessionId),
          status: { $in: BILLABLE_STATUSES },
        },
      },
      {
        $group: {
          _id: null,
          subtotal: { $sum: '$subtotal' },
          activeOrderCount: { $sum: 1 },
          // Không tính các món đã bị nhân viên huỷ / hết món.
          itemCount: {
            $sum: {
              $reduce: {
                input: '$items',
                initialValue: 0,
                in: {
                  $add: [
                    '$$value',
                    { $cond: [{ $eq: ['$$this.itemStatus', 'cancelled'] }, 0, '$$this.quantity'] },
                  ],
                },
              },
            },
          },
        },
      },
    ]),
    Order.countDocuments({ sessionId }),
    getSettings(),
  ]);
  const row = rows[0] ?? { subtotal: 0, activeOrderCount: 0, itemCount: 0 };
  return {
    orderCount,
    activeOrderCount: row.activeOrderCount,
    itemCount: row.itemCount,
    ...calculateTotals(row.subtotal, pricingOf(settings)),
  };
}
