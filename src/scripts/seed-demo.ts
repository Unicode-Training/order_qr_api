/**
 * Seed dữ liệu demo "Le Bistro & Grill": cài đặt nhà hàng, khu vực, ~20 bàn, danh mục, ~20 món (VND),
 * vài tài khoản nhân viên, các phiên/đơn/thanh toán lịch sử 14 ngày (để dashboard có số liệu) và
 * vài bàn đang phục vụ ở thời điểm chạy.
 *
 *   npm run seed:demo              # idempotent: chỉ thêm phần còn thiếu, không ghi đè dữ liệu đã có
 *   npm run seed:demo -- --reset   # xoá dữ liệu nghiệp vụ (giữ tài khoản không phải demo) rồi seed lại
 *
 * Không chạy --reset trên production trừ khi thêm `--yes`.
 */
import { Types, type Model as MongooseModel } from 'mongoose';
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { passwordSchema } from '../modules/auth/auth.schema';
import { RefreshToken } from '../modules/auth/refreshToken.model';
import { Area } from '../modules/areas/area.model';
import { Category } from '../modules/menu/category.model';
import { MenuItem, type IMenuItem, type MenuItemTag } from '../modules/menu/menuItem.model';
import {
  Order,
  OrderCounter,
  type IOrderItem,
  type IStatusHistoryEntry,
  type OrderStatus,
} from '../modules/orders/order.model';
import { toBusinessDate } from '../modules/orders/order.service';
import { calculateBillTotals } from '../modules/orders/pricing';
import { Payment } from '../modules/payments/payment.model';
import { ServiceRequest } from '../modules/serviceRequests/serviceRequest.model';
import { TableSession } from '../modules/sessions/tableSession.model';
import { RestaurantSettings } from '../modules/settings/settings.model';
import {
  DEFAULT_RESTAURANT_NAME,
  restaurantSettingsSchema,
  type PaymentMethod,
  type RestaurantSettingsData,
} from '../modules/settings/settings.schema';
import { getSettings, replaceSettings } from '../modules/settings/settings.service';
import { Table, type TableStatus } from '../modules/tables/table.model';
import { User } from '../modules/users/user.model';
import { logger } from '../utils/logger';
import { hashPassword } from '../utils/password';
import { zonedTimeToUtc } from '../utils/zonedDate';

export const DEMO_RESTAURANT_NAME = 'Le Bistro & Grill';
export const DEFAULT_DEMO_PASSWORD = 'Demo@123456';
const HISTORY_DAYS = 14;
const MINUTE = 60_000;

// ------------------------------------------------------------------ Dữ liệu mẫu

const DEMO_SETTINGS = {
  name: DEMO_RESTAURANT_NAME,
  slogan: 'Ẩm thực Âu – hương vị Việt',
  description:
    'Bistro phong cách Pháp với bít tết, hải sản nướng và mì Ý thủ công. Gọi món trực tiếp tại bàn bằng mã QR.',
  address: '45 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh',
  phone: '028 3822 4567',
  email: 'hello@lebistro.example',
  wifi: { ssid: 'LeBistro_Guest', password: 'bistro2024' },
  openingHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
    dayOfWeek,
    slots: [{ open: '10:00', close: dayOfWeek === 5 || dayOfWeek === 6 ? '23:30' : '22:30' }],
  })),
  currency: 'VND',
  vatPercent: 8,
  serviceChargePercent: 5,
  ordering: {
    enabled: true,
    requireStaffConfirm: true,
    allowOrderOutsideOpeningHours: false,
    maxItemQuantityPerOrder: 20,
  },
  paymentMethods: ['cash', 'bank_transfer', 'card'],
  bankTransferInfo: {
    bankName: 'Vietcombank',
    accountNumber: '0071001234567',
    accountName: 'CONG TY TNHH LE BISTRO',
  },
};

export const DEMO_AREAS = [
  { name: 'Tầng 1 - Sảnh chính', sortOrder: 1, prefix: 'A', count: 8, capacities: [2, 4] },
  { name: 'Tầng 2 - Phòng VIP', sortOrder: 2, prefix: 'V', count: 6, capacities: [6, 8] },
  { name: 'Sân vườn', sortOrder: 3, prefix: 'S', count: 6, capacities: [4] },
] as const;

export const DEMO_CATEGORIES = [
  { slug: 'khai-vi', name: 'Khai vị', icon: '🥗', description: 'Món nhẹ mở đầu bữa ăn' },
  {
    slug: 'bit-tet-nuong',
    name: 'Bít tết & Nướng',
    icon: '🥩',
    description: 'Thịt nướng than hoa',
  },
  { slug: 'mon-chinh', name: 'Món chính', icon: '🍝', description: 'Mì Ý, pizza, hải sản' },
  { slug: 'trang-mieng', name: 'Tráng miệng', icon: '🍰', description: null },
  { slug: 'do-uong', name: 'Đồ uống', icon: '🍹', description: 'Nước ép, trà, cà phê, rượu vang' },
] as const;

type CategorySlug = (typeof DEMO_CATEGORIES)[number]['slug'];

interface DemoMenuItem {
  slug: string;
  name: string;
  category: CategorySlug;
  price: number;
  originalPrice?: number;
  description?: string;
  tags?: MenuItemTag[];
  isAvailable?: boolean;
  prep?: number;
  optionGroups?: {
    name: string;
    required: boolean;
    maxSelect: number;
    options: { name: string; priceDelta: number }[];
  }[];
  /** Trọng số khi sinh đơn lịch sử (món bán chạy hơn). */
  weight: number;
}

const DONENESS = {
  name: 'Mức chín',
  required: true,
  maxSelect: 1,
  options: [
    { name: 'Tái (Rare)', priceDelta: 0 },
    { name: 'Vừa (Medium)', priceDelta: 0 },
    { name: 'Chín kỹ (Well done)', priceDelta: 0 },
  ],
};
const SAUCE = {
  name: 'Sốt',
  required: false,
  maxSelect: 2,
  options: [
    { name: 'Sốt tiêu đen', priceDelta: 0 },
    { name: 'Sốt nấm', priceDelta: 15000 },
    { name: 'Bơ tỏi', priceDelta: 10000 },
  ],
};

export const DEMO_MENU_ITEMS: DemoMenuItem[] = [
  // Khai vị
  {
    slug: 'sup-bi-do-kem-tuoi',
    name: 'Súp bí đỏ kem tươi',
    category: 'khai-vi',
    price: 65000,
    tags: ['vegetarian'],
    prep: 8,
    weight: 5,
  },
  {
    slug: 'salad-caesar-ga-nuong',
    name: 'Salad Caesar gà nướng',
    category: 'khai-vi',
    price: 95000,
    tags: ['bestseller'],
    prep: 10,
    weight: 7,
  },
  {
    slug: 'banh-mi-bo-toi',
    name: 'Bánh mì bơ tỏi',
    category: 'khai-vi',
    price: 45000,
    tags: ['vegetarian'],
    prep: 6,
    weight: 6,
  },
  {
    slug: 'goi-cuon-tom-thit',
    name: 'Gỏi cuốn tôm thịt',
    category: 'khai-vi',
    price: 69000,
    prep: 8,
    weight: 4,
  },
  // Bít tết & Nướng
  {
    slug: 'bit-tet-than-bo-uc',
    name: 'Bít tết thăn bò Úc 200g',
    category: 'bit-tet-nuong',
    price: 389000,
    originalPrice: 429000,
    description: 'Thăn ngoại bò Úc ăn ngũ cốc, kèm khoai tây nghiền và rau củ nướng.',
    tags: ['bestseller', 'chef_recommend'],
    prep: 20,
    optionGroups: [DONENESS, SAUCE],
    weight: 9,
  },
  {
    slug: 'suon-cuu-nuong-thao-moc',
    name: 'Sườn cừu nướng thảo mộc',
    category: 'bit-tet-nuong',
    price: 459000,
    tags: ['chef_recommend'],
    prep: 25,
    optionGroups: [DONENESS],
    isAvailable: false,
    weight: 3,
  },
  {
    slug: 'ba-chi-heo-nuong-mat-ong',
    name: 'Ba chỉ heo nướng mật ong',
    category: 'bit-tet-nuong',
    price: 189000,
    prep: 18,
    weight: 6,
  },
  {
    slug: 'ga-nuong-la-chanh',
    name: 'Gà nướng lá chanh',
    category: 'bit-tet-nuong',
    price: 169000,
    tags: ['spicy'],
    prep: 20,
    weight: 5,
  },
  // Món chính
  {
    slug: 'ca-hoi-ap-chao-sot-chanh-day',
    name: 'Cá hồi áp chảo sốt chanh dây',
    category: 'mon-chinh',
    price: 289000,
    tags: ['chef_recommend'],
    prep: 18,
    weight: 6,
  },
  {
    slug: 'mi-y-sot-bo-bam',
    name: 'Mì Ý sốt bò bằm',
    category: 'mon-chinh',
    price: 149000,
    tags: ['bestseller'],
    prep: 12,
    weight: 9,
  },
  {
    slug: 'mi-y-hai-san-sot-kem',
    name: 'Mì Ý hải sản sốt kem',
    category: 'mon-chinh',
    price: 179000,
    prep: 14,
    weight: 6,
  },
  {
    slug: 'pizza-margherita',
    name: 'Pizza Margherita',
    category: 'mon-chinh',
    price: 159000,
    tags: ['vegetarian', 'new'],
    prep: 15,
    optionGroups: [
      {
        name: 'Kích cỡ',
        required: true,
        maxSelect: 1,
        options: [
          { name: '20 cm', priceDelta: 0 },
          { name: '30 cm', priceDelta: 60000 },
        ],
      },
    ],
    weight: 7,
  },
  {
    slug: 'com-chien-hai-san',
    name: 'Cơm chiên hải sản',
    category: 'mon-chinh',
    price: 129000,
    tags: ['spicy'],
    prep: 12,
    weight: 5,
  },
  // Tráng miệng
  {
    slug: 'tiramisu',
    name: 'Tiramisu',
    category: 'trang-mieng',
    price: 79000,
    tags: ['bestseller'],
    prep: 3,
    weight: 6,
  },
  {
    slug: 'banh-flan-caramel',
    name: 'Bánh flan caramel',
    category: 'trang-mieng',
    price: 39000,
    prep: 3,
    weight: 4,
  },
  {
    slug: 'kem-vani-dau-tay',
    name: 'Kem vani dâu tây',
    category: 'trang-mieng',
    price: 55000,
    tags: ['new'],
    prep: 3,
    weight: 3,
  },
  // Đồ uống
  {
    slug: 'nuoc-cam-ep',
    name: 'Nước cam ép',
    category: 'do-uong',
    price: 49000,
    prep: 4,
    weight: 7,
  },
  {
    slug: 'tra-dao-cam-sa',
    name: 'Trà đào cam sả',
    category: 'do-uong',
    price: 45000,
    tags: ['bestseller'],
    prep: 4,
    weight: 8,
  },
  {
    slug: 'ca-phe-sua-da',
    name: 'Cà phê sữa đá',
    category: 'do-uong',
    price: 39000,
    prep: 3,
    weight: 6,
  },
  {
    slug: 'ruou-vang-do-ly',
    name: 'Rượu vang đỏ (ly)',
    category: 'do-uong',
    price: 129000,
    prep: 2,
    weight: 4,
  },
  {
    slug: 'bia-heineken',
    name: 'Bia Heineken',
    category: 'do-uong',
    price: 35000,
    prep: 1,
    weight: 7,
  },
  { slug: 'nuoc-suoi', name: 'Nước suối', category: 'do-uong', price: 20000, prep: 1, weight: 5 },
];

/** Tài khoản nhân viên mẫu — hệ thống không phân quyền theo vai trò, ai đăng nhập cũng toàn quyền. */
export const DEMO_STAFF = [
  { fullName: 'Nguyễn Minh Anh', email: 'minhanh@lebistro.example' },
  { fullName: 'Trần Quốc Bảo', email: 'quocbao@lebistro.example' },
  { fullName: 'Lê Thu Hà', email: 'thuha@lebistro.example' },
  { fullName: 'Phạm Đức Long', email: 'duclong@lebistro.example' },
] as const;

// ------------------------------------------------------------------ Tiện ích

/** PRNG có seed (mulberry32) → dữ liệu lịch sử giống nhau giữa các lần chạy. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const weighted = <T>(items: readonly T[], weight: (item: T) => number): T => {
    const total = items.reduce((sum, item) => sum + weight(item), 0);
    let roll = next() * total;
    for (const item of items) {
      roll -= weight(item);
      if (roll < 0) return item;
    }
    return items[items.length - 1]!;
  };
  return { next, int, pick, weighted };
}
type Random = ReturnType<typeof createRandom>;

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * MINUTE);

// ------------------------------------------------------------------ Seed danh mục

export interface SeedDemoOptions {
  reset?: boolean;
  /** Mốc "bây giờ" (để test). */
  now?: Date;
  /** Mật khẩu cho tài khoản demo mới tạo (mặc định SEED_DEMO_PASSWORD hoặc Demo@123456). */
  password?: string;
}

export interface SeedDemoResult {
  reset: boolean;
  settingsApplied: boolean;
  created: { areas: number; tables: number; categories: number; menuItems: number; staff: number };
  history: {
    generated: boolean;
    sessions: number;
    orders: number;
    payments: number;
    activeSessions: number;
  };
}

async function resetDemoData(): Promise<void> {
  const demoUserIds = (
    await User.find({ email: { $in: DEMO_STAFF.map((s) => s.email) } }, { _id: 1 }).lean()
  ).map((u) => u._id);
  await Promise.all([
    Area.deleteMany({}),
    Table.deleteMany({}),
    Category.deleteMany({}),
    MenuItem.deleteMany({}),
    TableSession.deleteMany({}),
    Order.deleteMany({}),
    OrderCounter.deleteMany({}),
    Payment.deleteMany({}),
    ServiceRequest.deleteMany({}),
    RestaurantSettings.deleteMany({}),
    RefreshToken.deleteMany({ user: { $in: demoUserIds } }),
    User.deleteMany({ _id: { $in: demoUserIds } }),
  ]);
}

/** Áp cài đặt demo khi nhà hàng còn tên mặc định (không ghi đè cài đặt người dùng đã sửa). */
async function seedSettings(): Promise<boolean> {
  const current = await getSettings();
  if (current.name !== DEFAULT_RESTAURANT_NAME) return false;
  await replaceSettings(restaurantSettingsSchema.parse(DEMO_SETTINGS) as RestaurantSettingsData);
  return true;
}

async function seedAreasAndTables(): Promise<{ areas: number; tables: number }> {
  let areas = 0;
  let tables = 0;
  for (const def of DEMO_AREAS) {
    let area = await Area.findOne({ name: def.name });
    if (!area) {
      area = await Area.create({ name: def.name, sortOrder: def.sortOrder });
      areas += 1;
    }
    for (let i = 1; i <= def.count; i += 1) {
      const code = `${def.prefix}${String(i).padStart(2, '0')}`;
      const result = await Table.updateOne(
        { code },
        {
          $setOnInsert: {
            code,
            name: `Bàn ${code}`,
            areaId: area._id,
            capacity: def.capacities[(i - 1) % def.capacities.length],
          },
        },
        { upsert: true },
      );
      tables += result.upsertedCount;
    }
  }
  return { areas, tables };
}

async function seedMenu(): Promise<{ categories: number; menuItems: number }> {
  let categories = 0;
  let menuItems = 0;
  const categoryIds = new Map<string, Types.ObjectId>();
  for (const [index, def] of DEMO_CATEGORIES.entries()) {
    let category = await Category.findOne({ slug: def.slug });
    if (!category) {
      category = await Category.create({ ...def, sortOrder: index + 1 });
      categories += 1;
    }
    categoryIds.set(def.slug, category._id);
  }
  for (const [index, def] of DEMO_MENU_ITEMS.entries()) {
    if (await MenuItem.exists({ slug: def.slug })) continue;
    await MenuItem.create({
      name: def.name,
      slug: def.slug,
      description: def.description ?? null,
      categoryId: categoryIds.get(def.category),
      price: def.price,
      originalPrice: def.originalPrice ?? null,
      tags: def.tags ?? [],
      isAvailable: def.isAvailable ?? true,
      preparationTimeMinutes: def.prep ?? null,
      sortOrder: index + 1,
      optionGroups: def.optionGroups ?? [],
    });
    menuItems += 1;
  }
  return { categories, menuItems };
}

async function seedStaff(password: string): Promise<number> {
  let created = 0;
  let passwordHash: string | undefined;
  for (const staff of DEMO_STAFF) {
    if (await User.exists({ email: staff.email })) continue;
    passwordHash ??= await hashPassword(password);
    await User.create({ ...staff, passwordHash });
    created += 1;
  }
  return created;
}

// ------------------------------------------------------------------ Lịch sử phiên / đơn / thanh toán

type MenuDoc = Pick<IMenuItem, 'name' | 'price' | 'slug' | 'optionGroups' | 'isAvailable'> & {
  _id: Types.ObjectId;
};
type TableDoc = { _id: Types.ObjectId; code: string; capacity: number };

interface Ctx {
  rnd: Random;
  menu: MenuDoc[];
  staffIds: Types.ObjectId[];
  pricing: { currency: string; vatPercent: number; serviceChargePercent: number };
  paymentMethods: PaymentMethod[];
  sessions: Record<string, unknown>[];
  orders: (Record<string, unknown> & { businessDate: string; createdAt: Date })[];
  payments: Record<string, unknown>[];
  requests: Record<string, unknown>[];
  tableStatus: Map<string, TableStatus>;
}

const weightOf = (item: MenuDoc) =>
  DEMO_MENU_ITEMS.find((def) => def.slug === item.slug)?.weight ?? 3;

function buildItems(ctx: Ctx, status: OrderStatus, count: number): IOrderItem[] {
  const { rnd } = ctx;
  const available = ctx.menu.filter((item) => item.isAvailable);
  const chosen = new Map<string, IOrderItem>();
  for (let i = 0; i < count; i += 1) {
    const menuItem = rnd.weighted(available, weightOf);
    const selectedOptions = menuItem.optionGroups
      .filter((group) => group.required || rnd.next() < 0.3)
      .map((group) => {
        const option = rnd.pick(group.options);
        return {
          groupId: group._id,
          groupName: group.name,
          optionId: option._id,
          optionName: option.name,
          priceDelta: option.priceDelta,
        };
      });
    const key = `${menuItem._id.toString()}|${selectedOptions.map((o) => o.optionId.toString()).join(',')}`;
    const existing = chosen.get(key);
    if (existing) {
      existing.quantity += 1;
      existing.lineTotal = existing.unitPrice * existing.quantity;
      continue;
    }
    const unitPrice = menuItem.price + selectedOptions.reduce((sum, o) => sum + o.priceDelta, 0);
    const quantity = rnd.next() < 0.25 ? 2 : 1;
    chosen.set(key, {
      _id: new Types.ObjectId(),
      menuItemId: menuItem._id,
      nameSnapshot: menuItem.name,
      priceSnapshot: menuItem.price,
      quantity,
      selectedOptions,
      unitPrice,
      lineTotal: unitPrice * quantity,
      note: null,
      itemStatus: status,
      cancelReason: status === 'cancelled' ? 'Khách đổi ý' : null,
    });
  }
  return [...chosen.values()];
}

const STATUS_FLOW: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];

/** Lịch sử trạng thái: guest tạo pending → nhân viên chuyển dần tới `finalStatus`. */
function buildHistory(
  ctx: Ctx,
  createdAt: Date,
  finalStatus: OrderStatus,
): { history: IStatusHistoryEntry[]; updatedAt: Date } {
  const staff = { type: 'staff' as const, userId: ctx.rnd.pick(ctx.staffIds) };
  const history: IStatusHistoryEntry[] = [
    { status: 'pending', at: createdAt, by: { type: 'guest', userId: null }, note: null },
  ];
  let at = createdAt;
  if (finalStatus === 'cancelled') {
    at = addMinutes(at, ctx.rnd.int(1, 4));
    history.push({ status: 'cancelled', at, by: staff, note: 'Khách đổi ý' });
    return { history, updatedAt: at };
  }
  const gaps: Partial<Record<OrderStatus, [number, number]>> = {
    confirmed: [1, 3],
    preparing: [1, 4],
    ready: [8, 20],
    served: [1, 4],
  };
  for (const status of STATUS_FLOW.slice(1, STATUS_FLOW.indexOf(finalStatus) + 1)) {
    const [min, max] = gaps[status]!;
    at = addMinutes(at, ctx.rnd.int(min, max));
    history.push({ status, at, by: staff, note: null });
  }
  return { history, updatedAt: at };
}

function addOrder(
  ctx: Ctx,
  session: { _id: Types.ObjectId; tableId: Types.ObjectId },
  createdAt: Date,
  status: OrderStatus,
): { subtotal: number; id: Types.ObjectId; endedAt: Date } {
  const items = buildItems(ctx, status, ctx.rnd.int(1, 4));
  const { history, updatedAt } = buildHistory(ctx, createdAt, status);
  const subtotal =
    status === 'cancelled' ? 0 : items.reduce((sum, item) => sum + item.lineTotal, 0);
  const _id = new Types.ObjectId();
  ctx.orders.push({
    _id,
    orderNumber: '',
    businessDate: toBusinessDate(createdAt),
    sessionId: session._id,
    tableId: session.tableId,
    items,
    note: null,
    status,
    subtotal,
    statusHistory: history,
    createdAt,
    updatedAt,
  });
  return { subtotal, id: _id, endedAt: updatedAt };
}

/** Phiên đã đóng + thanh toán. */
function addClosedSession(ctx: Ctx, table: TableDoc, openedAt: Date, cutoff: Date): void {
  const { rnd } = ctx;
  const orderCountBefore = ctx.orders.length;
  const session = { _id: new Types.ObjectId(), tableId: table._id };
  const orderCount = rnd.next() < 0.6 ? 1 : rnd.int(2, 3);
  let subtotal = 0;
  let lastAt = openedAt;
  const orderIds: Types.ObjectId[] = [];
  for (let i = 0; i < orderCount; i += 1) {
    const createdAt = addMinutes(openedAt, i === 0 ? rnd.int(2, 6) : rnd.int(20, 45) * i);
    const status: OrderStatus = i > 0 && rnd.next() < 0.1 ? 'cancelled' : 'served';
    const order = addOrder(ctx, session, createdAt, status);
    if (status !== 'cancelled') {
      subtotal += order.subtotal;
      orderIds.push(order.id);
    }
    if (order.endedAt > lastAt) lastAt = order.endedAt;
  }
  const paidAt = addMinutes(lastAt, rnd.int(25, 60));
  // Phiên chưa kịp thanh toán tại thời điểm seed → bỏ (huỷ các đơn vừa sinh).
  if (paidAt > cutoff) {
    ctx.orders.length = orderCountBefore;
    return;
  }
  const totals = calculateBillTotals(subtotal, ctx.pricing);
  const method = rnd.weighted(ctx.paymentMethods, (m) =>
    m === 'cash' ? 5 : m === 'bank_transfer' ? 4 : 2,
  );
  const amountReceived =
    method === 'cash' ? Math.ceil(totals.total / 50_000) * 50_000 : totals.total;
  const cashierId = rnd.pick(ctx.staffIds);
  ctx.sessions.push({
    ...session,
    status: 'closed',
    isActive: false,
    guestCount: Math.min(table.capacity, rnd.int(1, 6)),
    openedAt,
    closedAt: paidAt,
    closeReason: 'paid',
    closedBy: cashierId,
    createdAt: openedAt,
    updatedAt: paidAt,
  });
  ctx.payments.push({
    sessionId: session._id,
    tableId: table._id,
    tableCode: table.code,
    orderIds,
    currency: totals.currency,
    subtotal: totals.subtotal,
    serviceChargePercent: totals.serviceChargePercent,
    serviceCharge: totals.serviceCharge,
    vatPercent: totals.vatPercent,
    vat: totals.vatAmount,
    discount: 0,
    discountReason: null,
    total: totals.total,
    method,
    amountReceived,
    change: amountReceived - totals.total,
    note: null,
    forced: false,
    warnings: [],
    paidAt,
    businessDate: toBusinessDate(paidAt),
    cashierId,
    createdAt: paidAt,
    updatedAt: paidAt,
  });
}

/** Khung giờ đông khách (giờ địa phương) → trọng số. */
const HOURS = [11, 12, 13, 14, 17, 18, 19, 20, 21];
const hourWeight = (hour: number) =>
  hour === 12 || hour === 19 ? 4 : hour === 18 || hour === 20 ? 3 : 2;

function generateClosedSessions(ctx: Ctx, tables: TableDoc[], now: Date): void {
  const { rnd } = ctx;
  const today = toBusinessDate(now);
  for (let dayOffset = HISTORY_DAYS; dayOffset >= 0; dayOffset -= 1) {
    const date = toBusinessDate(
      new Date(zonedTimeToUtc(today, 12).getTime() - dayOffset * 86_400_000),
    );
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 5 || weekday === 6;
    const sessionCount = rnd.int(isWeekend ? 14 : 8, isWeekend ? 22 : 14);
    for (let i = 0; i < sessionCount; i += 1) {
      const hour = rnd.weighted(HOURS, hourWeight);
      const openedAt = addMinutes(zonedTimeToUtc(date, hour), rnd.int(0, 50));
      // Hôm nay: chỉ giữ phiên đã thanh toán xong trước thời điểm seed.
      addClosedSession(ctx, rnd.pick(tables), openedAt, addMinutes(now, -5));
    }
  }
}

/** Các bàn đang có khách ở thời điểm seed (để màn Live Orders / bàn có dữ liệu). */
function generateActiveSessions(ctx: Ctx, tables: TableDoc[], now: Date): number {
  const { rnd } = ctx;
  const plans: { statuses: OrderStatus[]; paymentRequested?: boolean; request?: string }[] = [
    { statuses: ['served', 'preparing'] },
    { statuses: ['confirmed'], request: 'request_water' },
    { statuses: ['pending'] },
    { statuses: ['ready', 'pending'], request: 'call_staff' },
    { statuses: ['served', 'served'], paymentRequested: true },
  ];
  plans.forEach((plan, index) => {
    const table = tables[index * 3]!;
    const openedAt = addMinutes(now, -rnd.int(35, 70));
    const session = { _id: new Types.ObjectId(), tableId: table._id };
    let lastAt = openedAt;
    plan.statuses.forEach((status, i) => {
      // Đơn sau tạo cách đơn trước, đơn cuối luôn trước hiện tại.
      const createdAt = addMinutes(openedAt, 3 + i * 18);
      const order = addOrder(ctx, session, createdAt, status);
      if (order.endedAt > lastAt) lastAt = order.endedAt;
    });
    const paymentRequestedAt = plan.paymentRequested ? addMinutes(now, -3) : null;
    ctx.sessions.push({
      ...session,
      status: plan.paymentRequested ? 'payment_requested' : 'open',
      isActive: true,
      guestCount: Math.min(table.capacity, rnd.int(2, 4)),
      openedAt,
      preferredPaymentMethod: plan.paymentRequested ? 'bank_transfer' : null,
      paymentRequestedAt,
      createdAt: openedAt,
      updatedAt: paymentRequestedAt ?? lastAt,
    });
    const requestType = plan.paymentRequested ? 'request_bill' : plan.request;
    if (requestType) {
      const createdAt = paymentRequestedAt ?? addMinutes(now, -rnd.int(1, 5));
      ctx.requests.push({
        sessionId: session._id,
        tableId: table._id,
        type: requestType,
        note: requestType === 'request_water' ? 'Thêm 2 ly đá' : null,
        status: 'pending',
        preferredMethod: plan.paymentRequested ? 'bank_transfer' : null,
        createdAt,
        updatedAt: createdAt,
      });
    }
    ctx.tableStatus.set(table._id.toString(), plan.paymentRequested ? 'needs_payment' : 'occupied');
  });
  // Một bàn đặt trước.
  const reserved = tables[tables.length - 1];
  if (reserved) ctx.tableStatus.set(reserved._id.toString(), 'reserved');
  return plans.length;
}

/** Đánh số đơn ORD-0001… theo từng ngày kinh doanh, rồi đồng bộ bộ đếm để đơn mới không trùng. */
async function assignOrderNumbers(ctx: Ctx): Promise<void> {
  ctx.orders.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const seqByDate = new Map<string, number>();
  for (const order of ctx.orders) {
    const seq = (seqByDate.get(order.businessDate) ?? 0) + 1;
    seqByDate.set(order.businessDate, seq);
    order.orderNumber = `ORD-${String(seq).padStart(4, '0')}`;
  }
  await Promise.all(
    [...seqByDate].map(([key, seq]) =>
      OrderCounter.updateOne({ key }, { $max: { seq } }, { upsert: true }),
    ),
  );
}

/**
 * Validate bằng schema Mongoose (chạy cả hook pre-validate, vd. TableSession.isActive) rồi ghi thẳng
 * vào collection để giữ nguyên createdAt/updatedAt lịch sử (Mongoose timestamps sẽ ghi đè).
 */
async function insertWithTimestamps(
  model: MongooseModel<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  docs: Record<string, unknown>[],
): Promise<void> {
  if (docs.length === 0) return;
  const hydrated = docs.map((doc) => new model(doc));
  await Promise.all(hydrated.map((doc) => doc.validate()));
  await model.collection.insertMany(hydrated.map((doc) => doc.toObject({ depopulate: true })));
}

async function seedHistory(now: Date): Promise<SeedDemoResult['history']> {
  const skipped = { generated: false, sessions: 0, orders: 0, payments: 0, activeSessions: 0 };
  const [hasOrders, hasSessions, hasPayments] = await Promise.all([
    Order.exists({}),
    TableSession.exists({}),
    Payment.exists({}),
  ]);
  if (hasOrders || hasSessions || hasPayments) return skipped;

  const settings = await getSettings();
  const tables = await Table.find({ isActive: true }, { code: 1, capacity: 1 })
    .sort({ code: 1 })
    .lean<TableDoc[]>();
  const menu = await MenuItem.find({ isActive: true }).lean<MenuDoc[]>();
  const staffIds = (
    await User.find({ email: { $in: DEMO_STAFF.map((s) => s.email) } }, { _id: 1 }).lean()
  ).map((u) => u._id);
  if (tables.length === 0 || menu.length === 0 || staffIds.length === 0) return skipped;

  const ctx: Ctx = {
    rnd: createRandom(20240601),
    menu,
    staffIds,
    pricing: {
      currency: settings.currency,
      vatPercent: settings.vatPercent,
      serviceChargePercent: settings.serviceChargePercent,
    },
    paymentMethods: settings.paymentMethods,
    sessions: [],
    orders: [],
    payments: [],
    requests: [],
    tableStatus: new Map(),
  };

  const activeTables = tables.slice(0, -1);
  const activeSessions = generateActiveSessions(ctx, activeTables, now);
  generateClosedSessions(ctx, tables, now);
  await assignOrderNumbers(ctx);

  await insertWithTimestamps(TableSession, ctx.sessions);
  await insertWithTimestamps(Order, ctx.orders);
  await insertWithTimestamps(Payment, ctx.payments);
  await insertWithTimestamps(ServiceRequest, ctx.requests);
  await Table.updateMany({}, { $set: { status: 'available' } });
  await Promise.all(
    [...ctx.tableStatus].map(([id, status]) => Table.updateOne({ _id: id }, { $set: { status } })),
  );

  return {
    generated: true,
    sessions: ctx.sessions.length,
    orders: ctx.orders.length,
    payments: ctx.payments.length,
    activeSessions,
  };
}

// ------------------------------------------------------------------ Entry

export async function seedDemo(options: SeedDemoOptions = {}): Promise<SeedDemoResult> {
  const now = options.now ?? new Date();
  const password = passwordSchema.parse(
    options.password ?? (process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD),
  );
  const reset = options.reset ?? false;
  if (reset) await resetDemoData();

  const settingsApplied = await seedSettings();
  const { areas, tables } = await seedAreasAndTables();
  const { categories, menuItems } = await seedMenu();
  const staff = await seedStaff(password);
  const history = await seedHistory(now);

  return {
    reset,
    settingsApplied,
    created: { areas, tables, categories, menuItems, staff },
    history,
  };
}

const cliSchema = z.object({ reset: z.boolean(), yes: z.boolean() });

export function parseSeedDemoArgs(argv: string[]): z.infer<typeof cliSchema> {
  const unknown = argv.filter((arg) => !['--reset', '--yes'].includes(arg));
  if (unknown.length > 0) {
    throw new Error(`Tham số không hợp lệ: ${unknown.join(' ')} (chỉ hỗ trợ --reset, --yes)`);
  }
  return cliSchema.parse({ reset: argv.includes('--reset'), yes: argv.includes('--yes') });
}

async function main(): Promise<void> {
  const args = parseSeedDemoArgs(process.argv.slice(2));
  if (args.reset && process.env.NODE_ENV === 'production' && !args.yes) {
    throw new Error(
      'Từ chối --reset khi NODE_ENV=production. Thêm --yes nếu thật sự muốn xoá dữ liệu.',
    );
  }
  await connectDatabase();
  try {
    const result = await seedDemo({ reset: args.reset });
    const { created, history } = result;
    if (result.reset) logger.warn('Đã xoá dữ liệu nghiệp vụ cũ (--reset)');
    logger.info(
      result.settingsApplied
        ? `Đã áp cài đặt nhà hàng "${DEMO_RESTAURANT_NAME}"`
        : 'Cài đặt nhà hàng đã khác mặc định — giữ nguyên',
    );
    logger.info(
      `Tạo mới: ${created.areas} khu vực, ${created.tables} bàn, ${created.categories} danh mục, ` +
        `${created.menuItems} món, ${created.staff} nhân viên`,
    );
    if (history.generated) {
      logger.info(
        `Lịch sử: ${history.sessions} phiên (${history.activeSessions} đang mở), ` +
          `${history.orders} đơn, ${history.payments} thanh toán`,
      );
    } else {
      logger.warn('Đã có phiên/đơn/thanh toán — bỏ qua sinh lịch sử (dùng --reset để tạo lại)');
    }
    if (created.staff > 0) {
      logger.info(
        `Tài khoản demo: ${DEMO_STAFF.map((s) => s.email).join(', ')} ` +
          `(mật khẩu: SEED_DEMO_PASSWORD hoặc mặc định ${DEFAULT_DEMO_PASSWORD})`,
      );
    }
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    logger.error(
      err instanceof Error ? err.message : 'Seed demo thất bại',
      err instanceof Error ? undefined : err,
    );
    process.exit(1);
  });
}
