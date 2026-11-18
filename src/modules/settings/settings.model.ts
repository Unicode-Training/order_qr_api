import { model, Schema } from 'mongoose';
import type { RestaurantSettingsData } from './settings.schema';
import { PAYMENT_METHODS } from './settings.schema';

/** Khoá cố định của document singleton duy nhất. */
export const SETTINGS_SINGLETON_KEY = 'default';

export interface IRestaurantSettings extends RestaurantSettingsData {
  /** Khoá singleton (unique) — luôn là `SETTINGS_SINGLETON_KEY`. Trường nội bộ. */
  key: string;
  createdAt: Date;
  updatedAt: Date;
}

const imageSchema = new Schema(
  { url: { type: String, required: true }, publicId: { type: String, default: null } },
  { _id: false },
);

const timeSlotSchema = new Schema(
  { open: { type: String, required: true }, close: { type: String, required: true } },
  { _id: false },
);

const dayOpeningHoursSchema = new Schema(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    slots: { type: [timeSlotSchema], default: [] },
  },
  { _id: false },
);

const orderingSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    requireStaffConfirm: { type: Boolean, default: true },
    allowOrderOutsideOpeningHours: { type: Boolean, default: false },
    maxItemQuantityPerOrder: { type: Number, default: 50, min: 1 },
  },
  { _id: false },
);

const wifiSchema = new Schema(
  { ssid: { type: String, required: true }, password: { type: String, default: null } },
  { _id: false },
);

const bankTransferInfoSchema = new Schema(
  {
    bankName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    accountName: { type: String, required: true },
  },
  { _id: false },
);

/**
 * Cài đặt nhà hàng — singleton: chỉ có một document (`key = 'default'`, unique).
 * Validate nghiệp vụ nằm ở zod (`settings.schema.ts`); schema Mongoose chỉ mô tả cấu trúc lưu trữ.
 * Không đọc/ghi trực tiếp model này — dùng `settings.service.ts`.
 */
const restaurantSettingsSchema = new Schema<IRestaurantSettings>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: SETTINGS_SINGLETON_KEY,
    },
    name: { type: String, required: true },
    slogan: { type: String, default: null },
    description: { type: String, default: null },
    logo: { type: imageSchema, default: null },
    coverImage: { type: imageSchema, default: null },
    address: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    wifi: { type: wifiSchema, default: null },
    openingHours: { type: [dayOpeningHoursSchema], default: [] },
    currency: { type: String, default: 'VND' },
    vatPercent: { type: Number, default: 0, min: 0, max: 100 },
    serviceChargePercent: { type: Number, default: 0, min: 0, max: 100 },
    ordering: { type: orderingSchema, default: () => ({}) },
    paymentMethods: { type: [{ type: String, enum: PAYMENT_METHODS }], default: ['cash'] },
    bankTransferInfo: { type: bankTransferInfoSchema, default: null },
  },
  { timestamps: true, collection: 'restaurantsettings' },
);

export const RestaurantSettings = model<IRestaurantSettings>(
  'RestaurantSettings',
  restaurantSettingsSchema,
);
