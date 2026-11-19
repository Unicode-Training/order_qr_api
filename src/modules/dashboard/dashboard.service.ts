import type { Types } from 'mongoose';
import { RESTAURANT_TIMEZONE } from '../../utils/openingHours';
import { addDays, diffDays, zonedDayRange, zonedTimeToUtc } from '../../utils/zonedDate';
import { MenuItem } from '../menu/menuItem.model';
import { toAdminOrderDtos, type AdminOrderDto } from '../orders/adminOrder.service';
import { Order } from '../orders/order.model';
import type { LeanOrder } from '../orders/order.service';
import { COUNTED_PAYMENT_FILTER, Payment } from '../payments/payment.model';
import { ServiceRequest } from '../serviceRequests/serviceRequest.model';
import { TableSession } from '../sessions/tableSession.model';
import { PAYMENT_METHODS, type PaymentMethod } from '../settings/settings.schema';
import { getSettings } from '../settings/settings.service';
import { Table } from '../tables/table.model';
import type {
  GroupBy,
  PaymentMethodsQuery,
  RecentOrdersQuery,
  RevenueQuery,
  SummaryQuery,
  TopItemsQuery,
} from './dashboard.schema';

const TZ = RESTAURANT_TIMEZONE;

/** Làm tròn 1 chữ số thập phân. */
const round1 = (value: number) => Math.round(value * 10) / 10;

/** % thay đổi so với kỳ trước; kỳ trước = 0 → null (trừ khi cả hai = 0 → 0). */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return round1(((current - previous) / previous) * 100);
}

const percentOf = (part: number, whole: number) => (whole === 0 ? 0 : round1((part / whole) * 100));

async function getCurrency(): Promise<string> {
  return (await getSettings()).currency;
}

// ------------------------------------------------------------------ Tổng quan

export interface DashboardSummary {
  date: string;
  timezone: string;
  currency: string;
  revenue: { today: number; yesterday: number; changePercent: number | null };
  orders: {
    /** Số đơn tạo trong ngày (không tính đơn huỷ). */
    count: number;
    yesterday: number;
    changePercent: number | null;
    cancelled: number;
  };
  invoices: {
    /** Số hoá đơn đã thanh toán trong ngày. */
    count: number;
    /** Giá trị trung bình / hoá đơn (đã làm tròn đơn vị tiền). */
    averageValue: number;
    yesterdayAverageValue: number;
    averageValueChangePercent: number | null;
  };
  tables: {
    /** Bàn đang phục vụ (occupied + needs_payment) — trạng thái hiện tại. */
    serving: number;
    needsPayment: number;
    /** Tổng số bàn đang hoạt động. */
    total: number;
    occupancyPercent: number;
  };
  serviceTime: {
    /** Thời gian trung bình (phút) từ confirmed → served của các đơn trong ngày; null nếu chưa có. */
    averageMinutes: number | null;
    servedOrders: number;
  };
  pending: {
    /** Yêu cầu nhanh tại bàn đang chờ (status = pending) — hiện tại. */
    serviceRequests: number;
    /** Đơn đang chờ xác nhận (status = pending) — hiện tại. */
    orders: number;
    total: number;
  };
  generatedAt: Date;
}

function averageMoney(total: number, count: number): number {
  return count === 0 ? 0 : Math.round(total / count);
}

export async function getSummary(query: SummaryQuery): Promise<DashboardSummary> {
  const date = query.date;
  const yesterday = addDays(date, -1);
  const days = [date, yesterday];

  const [
    currency,
    revenueGroups,
    orderGroups,
    serviceTime,
    tableStats,
    pendingRequests,
    pendingOrders,
  ] = await Promise.all([
    getCurrency(),
    Payment.aggregate<{ _id: string; total: number; count: number }>([
      { $match: { businessDate: { $in: days }, ...COUNTED_PAYMENT_FILTER } },
      { $group: { _id: '$businessDate', total: { $sum: '$total' }, count: { $sum: 1 } } },
    ]),
    Order.aggregate<{ _id: { date: string; cancelled: boolean }; count: number }>([
      { $match: { businessDate: { $in: days } } },
      {
        $group: {
          _id: { date: '$businessDate', cancelled: { $eq: ['$status', 'cancelled'] } },
          count: { $sum: 1 },
        },
      },
    ]),
    Order.aggregate<{ avgMs: number; count: number }>([
      { $match: { businessDate: date, status: 'served' } },
      {
        $project: {
          // Lần xác nhận đầu tiên và lần phục vụ cuối cùng trong lịch sử trạng thái.
          confirmedAt: {
            $min: {
              $map: {
                input: {
                  $filter: {
                    input: '$statusHistory',
                    cond: { $eq: ['$$this.status', 'confirmed'] },
                  },
                },
                in: '$$this.at',
              },
            },
          },
          servedAt: {
            $max: {
              $map: {
                input: {
                  $filter: { input: '$statusHistory', cond: { $eq: ['$$this.status', 'served'] } },
                },
                in: '$$this.at',
              },
            },
          },
        },
      },
      { $match: { confirmedAt: { $type: 'date' }, servedAt: { $type: 'date' } } },
      { $project: { durationMs: { $subtract: ['$servedAt', '$confirmedAt'] } } },
      { $match: { durationMs: { $gte: 0 } } },
      { $group: { _id: null, avgMs: { $avg: '$durationMs' }, count: { $sum: 1 } } },
    ]),
    Table.aggregate<{ total: number; serving: number; needsPayment: number }>([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          serving: {
            $sum: { $cond: [{ $in: ['$status', ['occupied', 'needs_payment']] }, 1, 0] },
          },
          needsPayment: { $sum: { $cond: [{ $eq: ['$status', 'needs_payment'] }, 1, 0] } },
        },
      },
    ]),
    ServiceRequest.countDocuments({ status: 'pending' }),
    Order.countDocuments({ status: 'pending' }),
  ]);

  const revenueOf = (day: string) =>
    revenueGroups.find((g) => g._id === day) ?? { total: 0, count: 0 };
  const ordersOf = (day: string, cancelled: boolean) =>
    orderGroups.find((g) => g._id.date === day && g._id.cancelled === cancelled)?.count ?? 0;

  const today = revenueOf(date);
  const prev = revenueOf(yesterday);
  const avgToday = averageMoney(today.total, today.count);
  const avgPrev = averageMoney(prev.total, prev.count);
  const orderCount = ordersOf(date, false);
  const orderCountPrev = ordersOf(yesterday, false);
  const tables = tableStats[0] ?? { total: 0, serving: 0, needsPayment: 0 };
  const service = serviceTime[0];

  return {
    date,
    timezone: TZ,
    currency,
    revenue: {
      today: today.total,
      yesterday: prev.total,
      changePercent: percentChange(today.total, prev.total),
    },
    orders: {
      count: orderCount,
      yesterday: orderCountPrev,
      changePercent: percentChange(orderCount, orderCountPrev),
      cancelled: ordersOf(date, true),
    },
    invoices: {
      count: today.count,
      averageValue: avgToday,
      yesterdayAverageValue: avgPrev,
      averageValueChangePercent: percentChange(avgToday, avgPrev),
    },
    tables: {
      serving: tables.serving,
      needsPayment: tables.needsPayment,
      total: tables.total,
      occupancyPercent: percentOf(tables.serving, tables.total),
    },
    serviceTime: {
      averageMinutes: service ? round1(service.avgMs / 60_000) : null,
      servedOrders: service?.count ?? 0,
    },
    pending: {
      serviceRequests: pendingRequests,
      orders: pendingOrders,
      total: pendingRequests + pendingOrders,
    },
    generatedAt: new Date(),
  };
}

// ------------------------------------------------------------------ Biểu đồ doanh thu

/** Định dạng khoá mốc ($dateToString) theo kiểu nhóm. */
const BUCKET_FORMAT: Record<GroupBy, string> = {
  hour: '%Y-%m-%dT%H:00',
  day: '%Y-%m-%d',
  month: '%Y-%m',
};

export interface RevenuePoint {
  /** Khoá mốc theo giờ nhà hàng: "YYYY-MM-DDTHH:00" | "YYYY-MM-DD" | "YYYY-MM". */
  key: string;
  /** Thời điểm bắt đầu mốc (UTC). */
  start: Date;
  revenue: number;
  /** Số hoá đơn đã thanh toán. */
  invoices: number;
  /** Số khách (tổng guestCount của phiên đã thanh toán; phiên không khai báo tính 1). */
  guests: number;
}

export interface RevenueSeries {
  from: string;
  to: string;
  groupBy: GroupBy;
  timezone: string;
  currency: string;
  points: RevenuePoint[];
  totals: { revenue: number; invoices: number; guests: number };
}

/** Danh sách mốc liên tục phủ from..to (để điền 0 cho mốc trống). */
function buildBuckets(from: string, to: string, groupBy: GroupBy): { key: string; start: Date }[] {
  const buckets: { key: string; start: Date }[] = [];
  const dayCount = diffDays(from, to) + 1;
  if (groupBy === 'month') {
    const seen = new Set<string>();
    for (let i = 0; i < dayCount; i += 1) {
      const day = addDays(from, i);
      const key = day.slice(0, 7);
      if (seen.has(key)) continue;
      seen.add(key);
      buckets.push({ key, start: zonedTimeToUtc(`${key}-01`, 0, TZ) });
    }
    return buckets;
  }
  for (let i = 0; i < dayCount; i += 1) {
    const day = addDays(from, i);
    if (groupBy === 'day') {
      buckets.push({ key: day, start: zonedTimeToUtc(day, 0, TZ) });
      continue;
    }
    for (let hour = 0; hour < 24; hour += 1) {
      buckets.push({
        key: `${day}T${String(hour).padStart(2, '0')}:00`,
        start: zonedTimeToUtc(day, hour, TZ),
      });
    }
  }
  return buckets;
}

export async function getRevenueSeries(query: RevenueQuery): Promise<RevenueSeries> {
  const { from, to, groupBy } = query;
  const { start, end } = zonedDayRange(from, to, TZ);

  const [currency, groups] = await Promise.all([
    getCurrency(),
    Payment.aggregate<{ _id: string; revenue: number; invoices: number; guests: number }>([
      { $match: { paidAt: { $gte: start, $lt: end }, ...COUNTED_PAYMENT_FILTER } },
      {
        $lookup: {
          from: TableSession.collection.collectionName,
          localField: 'sessionId',
          foreignField: '_id',
          pipeline: [{ $project: { guestCount: 1 } }],
          as: 'session',
        },
      },
      {
        $group: {
          _id: { $dateToString: { date: '$paidAt', format: BUCKET_FORMAT[groupBy], timezone: TZ } },
          revenue: { $sum: '$total' },
          invoices: { $sum: 1 },
          guests: { $sum: { $ifNull: [{ $first: '$session.guestCount' }, 1] } },
        },
      },
    ]),
  ]);

  const byKey = new Map(groups.map((g) => [g._id, g]));
  const points = buildBuckets(from, to, groupBy).map(({ key, start: bucketStart }) => {
    const g = byKey.get(key);
    return {
      key,
      start: bucketStart,
      revenue: g?.revenue ?? 0,
      invoices: g?.invoices ?? 0,
      guests: g?.guests ?? 0,
    };
  });

  return {
    from,
    to,
    groupBy,
    timezone: TZ,
    currency,
    points,
    totals: {
      revenue: points.reduce((sum, p) => sum + p.revenue, 0),
      invoices: points.reduce((sum, p) => sum + p.invoices, 0),
      guests: points.reduce((sum, p) => sum + p.guests, 0),
    },
  };
}

// ------------------------------------------------------------------ Món bán chạy

export interface TopItem {
  menuItemId: string;
  /** Tên hiện tại của món (nếu món còn tồn tại), ngược lại tên lúc đặt gần nhất. */
  name: string;
  image: { url: string } | null;
  quantity: number;
  /** Doanh thu theo giá món (tổng lineTotal, chưa gồm VAT/phí/giảm giá). */
  revenue: number;
  /** Số đơn có món này. */
  orderCount: number;
}

export interface TopItemsResult {
  from: string;
  to: string;
  currency: string;
  items: TopItem[];
}

export async function getTopItems(query: TopItemsQuery): Promise<TopItemsResult> {
  const [currency, rows] = await Promise.all([
    getCurrency(),
    Order.aggregate<{
      _id: Types.ObjectId;
      name: string;
      quantity: number;
      revenue: number;
      orderCount: number;
      menuItem: { name: string; image: { url: string } | null }[];
    }>([
      {
        $match: {
          businessDate: { $gte: query.from, $lte: query.to },
          status: { $ne: 'cancelled' },
        },
      },
      { $sort: { createdAt: 1 } },
      { $unwind: '$items' },
      { $match: { 'items.itemStatus': { $ne: 'cancelled' } } },
      {
        $group: {
          _id: '$items.menuItemId',
          name: { $last: '$items.nameSnapshot' },
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' },
          orders: { $addToSet: '$_id' },
        },
      },
      { $addFields: { orderCount: { $size: '$orders' } } },
      { $sort: { quantity: -1, revenue: -1, _id: 1 } },
      { $limit: query.limit },
      {
        $lookup: {
          from: MenuItem.collection.collectionName,
          localField: '_id',
          foreignField: '_id',
          pipeline: [{ $project: { name: 1, image: 1 } }],
          as: 'menuItem',
        },
      },
      { $project: { orders: 0 } },
    ]),
  ]);

  return {
    from: query.from,
    to: query.to,
    currency,
    items: rows.map((row) => {
      const menuItem = row.menuItem[0];
      return {
        menuItemId: row._id.toString(),
        name: menuItem?.name ?? row.name,
        image: menuItem?.image?.url ? { url: menuItem.image.url } : null,
        quantity: row.quantity,
        revenue: row.revenue,
        orderCount: row.orderCount,
      };
    }),
  };
}

// ------------------------------------------------------------------ Đơn gần đây

export async function getRecentOrders(query: RecentOrdersQuery): Promise<AdminOrderDto[]> {
  const orders = await Order.find()
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit)
    .lean<LeanOrder[]>();
  return toAdminOrderDtos(orders);
}

// ------------------------------------------------------------------ Tỉ lệ phương thức thanh toán

export interface PaymentMethodShare {
  method: PaymentMethod;
  count: number;
  amount: number;
  /** % theo số tiền. */
  amountPercent: number;
  /** % theo số hoá đơn. */
  countPercent: number;
}

export interface PaymentMethodsResult {
  from: string;
  to: string;
  currency: string;
  totalAmount: number;
  totalCount: number;
  items: PaymentMethodShare[];
}

export async function getPaymentMethods(query: PaymentMethodsQuery): Promise<PaymentMethodsResult> {
  const { start, end } = zonedDayRange(query.from, query.to, TZ);
  const [currency, groups] = await Promise.all([
    getCurrency(),
    Payment.aggregate<{ _id: PaymentMethod; count: number; amount: number }>([
      { $match: { paidAt: { $gte: start, $lt: end }, ...COUNTED_PAYMENT_FILTER } },
      { $group: { _id: '$method', count: { $sum: 1 }, amount: { $sum: '$total' } } },
    ]),
  ]);

  const totalAmount = groups.reduce((sum, g) => sum + g.amount, 0);
  const totalCount = groups.reduce((sum, g) => sum + g.count, 0);
  const items = PAYMENT_METHODS.map((method) => {
    const g = groups.find((group) => group._id === method);
    const count = g?.count ?? 0;
    const amount = g?.amount ?? 0;
    return {
      method,
      count,
      amount,
      amountPercent: percentOf(amount, totalAmount),
      countPercent: percentOf(count, totalCount),
    };
  }).sort((a, b) => b.amount - a.amount || b.count - a.count);

  return { from: query.from, to: query.to, currency, totalAmount, totalCount, items };
}
