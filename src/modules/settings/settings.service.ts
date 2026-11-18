import { AppError } from '../../utils/AppError';
import { isOpenNow, RESTAURANT_TIMEZONE } from '../../utils/openingHours';
import {
  RestaurantSettings,
  SETTINGS_SINGLETON_KEY,
  type IRestaurantSettings,
} from './settings.model';
import {
  DEFAULT_RESTAURANT_NAME,
  restaurantSettingsSchema,
  SETTINGS_FIELDS,
  type PatchSettingsInput,
  type PaymentMethod,
  type RestaurantSettingsData,
  type RestaurantSettingsInput,
} from './settings.schema';

export interface AdminSettings extends RestaurantSettingsData {
  updatedAt: Date;
}

export interface PricingConfig {
  currency: string;
  vatPercent: number;
  serviceChargePercent: number;
}

export interface PublicRestaurant {
  name: string;
  slogan: string | null;
  description: string | null;
  logo: { url: string } | null;
  coverImage: { url: string } | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  wifi: { ssid: string; password: string | null } | null;
  openingHours: RestaurantSettingsData['openingHours'];
  timezone: string;
  isOpenNow: boolean;
  currency: string;
  vatPercent: number;
  serviceChargePercent: number;
  ordering: RestaurantSettingsData['ordering'] & {
    /** ordering.enabled && (đang mở cửa || cho phép đặt ngoài giờ). */
    canOrderNow: boolean;
  };
  paymentMethods: PaymentMethod[];
  /** Chỉ có khi bật phương thức bank_transfer. */
  bankTransferInfo: RestaurantSettingsData['bankTransferInfo'];
}

type StoredSettings = Pick<IRestaurantSettings, keyof RestaurantSettingsData | 'updatedAt'>;

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Bỏ các trường nội bộ (_id, key, createdAt, __v...) — chỉ giữ dữ liệu cài đặt. */
function pickSettingsData(doc: StoredSettings): RestaurantSettingsData {
  return Object.fromEntries(
    SETTINGS_FIELDS.map((field) => [field, doc[field]]),
  ) as unknown as RestaurantSettingsData;
}

/** Giá trị mặc định khi nhà hàng chưa được cài đặt. */
export function buildDefaultSettings(): RestaurantSettingsData {
  return restaurantSettingsSchema.parse({ name: DEFAULT_RESTAURANT_NAME });
}

/** Đọc document singleton; tự tạo với giá trị mặc định nếu chưa có (an toàn khi gọi đồng thời). */
async function loadSettings(): Promise<StoredSettings> {
  const existing = await RestaurantSettings.findOne({ key: SETTINGS_SINGLETON_KEY }).lean();
  if (existing) return existing;
  try {
    const created = await RestaurantSettings.create({
      key: SETTINGS_SINGLETON_KEY,
      ...buildDefaultSettings(),
    });
    return created.toObject();
  } catch (err) {
    // Request khác vừa tạo trước (unique index trên `key`) → đọc lại
    if (!isDuplicateKeyError(err)) throw err;
    const created = await RestaurantSettings.findOne({ key: SETTINGS_SINGLETON_KEY }).lean();
    if (!created) throw err;
    return created;
  }
}

async function saveSettings(data: RestaurantSettingsData): Promise<AdminSettings> {
  const saved = await RestaurantSettings.findOneAndUpdate(
    { key: SETTINGS_SINGLETON_KEY },
    { $set: data },
    { upsert: true, returnDocument: 'after', lean: true },
  );
  if (!saved) throw AppError.internal('Không lưu được cài đặt nhà hàng');
  return toAdminSettings(saved);
}

function toAdminSettings(doc: StoredSettings): AdminSettings {
  return { ...pickSettingsData(doc), updatedAt: doc.updatedAt };
}

/** Toàn bộ cài đặt (cho admin và các module khác). */
export async function getSettings(): Promise<AdminSettings> {
  return toAdminSettings(await loadSettings());
}

/** PUT: thay toàn bộ cài đặt. `input` đã được validate bằng `restaurantSettingsSchema`. */
export async function replaceSettings(input: RestaurantSettingsData): Promise<AdminSettings> {
  return saveSettings(input);
}

/**
 * PATCH: gộp vào cài đặt hiện tại rồi validate lại toàn bộ.
 * - Object lồng nhau (ordering, wifi, logo, coverImage, bankTransferInfo) được gộp nông
 *   (chỉ ghi đè các trường gửi lên); gửi `null` để xoá.
 * - Mảng (openingHours, paymentMethods) bị thay thế toàn bộ.
 */
export async function patchSettings(patch: PatchSettingsInput): Promise<AdminSettings> {
  const current = pickSettingsData(await loadSettings());
  const merged: Record<string, unknown> = { ...current };
  for (const [field, value] of Object.entries(patch)) {
    const currentValue = merged[field];
    merged[field] =
      isPlainObject(value) && isPlainObject(currentValue) ? { ...currentValue, ...value } : value;
  }

  const result = restaurantSettingsSchema.safeParse(merged as RestaurantSettingsInput);
  if (!result.success) {
    throw AppError.validation(
      'Dữ liệu không hợp lệ',
      result.error.issues.map((issue) => ({
        location: 'body',
        path: issue.path.map(String).join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
  return saveSettings(result.data);
}

/** Cấu hình tính tiền cho module đơn hàng (VAT, phí phục vụ, tiền tệ). */
export async function getPricingConfig(): Promise<PricingConfig> {
  const { currency, vatPercent, serviceChargePercent } = await loadSettings();
  return { currency, vatPercent, serviceChargePercent };
}

/** Khách có được đặt món ở thời điểm `now` không (dùng cho public API và module đơn hàng). */
export function canOrderAt(
  settings: Pick<RestaurantSettingsData, 'ordering' | 'openingHours'>,
  now: Date = new Date(),
): boolean {
  if (!settings.ordering.enabled) return false;
  return settings.ordering.allowOrderOutsideOpeningHours || isOpenNow(settings.openingHours, now);
}

/** Thông tin công khai cho khách — không có trường nội bộ (publicId ảnh, key, _id...). */
export function toPublicRestaurant(
  settings: RestaurantSettingsData,
  now: Date = new Date(),
): PublicRestaurant {
  const openNow = isOpenNow(settings.openingHours, now);
  return {
    name: settings.name,
    slogan: settings.slogan,
    description: settings.description,
    logo: settings.logo ? { url: settings.logo.url } : null,
    coverImage: settings.coverImage ? { url: settings.coverImage.url } : null,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    wifi: settings.wifi ? { ssid: settings.wifi.ssid, password: settings.wifi.password } : null,
    openingHours: settings.openingHours,
    timezone: RESTAURANT_TIMEZONE,
    isOpenNow: openNow,
    currency: settings.currency,
    vatPercent: settings.vatPercent,
    serviceChargePercent: settings.serviceChargePercent,
    ordering: { ...settings.ordering, canOrderNow: canOrderAt(settings, now) },
    paymentMethods: settings.paymentMethods,
    bankTransferInfo: settings.paymentMethods.includes('bank_transfer')
      ? settings.bankTransferInfo
      : null,
  };
}

export async function getPublicRestaurant(now: Date = new Date()): Promise<PublicRestaurant> {
  return toPublicRestaurant(pickSettingsData(await loadSettings()), now);
}
