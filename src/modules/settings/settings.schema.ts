import { z } from 'zod';
import {
  CLOSE_TIME_REGEX,
  findOverlappingSlots,
  OPEN_TIME_REGEX,
  timeToMinutes,
} from '../../utils/openingHours';
import { emailSchema } from '../auth/auth.schema';

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DEFAULT_RESTAURANT_NAME = 'Nhà hàng của tôi';

/** Chuỗi tuỳ chọn: trim, chuỗi rỗng → null. */
const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự`)
    .nullable()
    .transform((value) => (value ? value : null));

const httpUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https?$/, message: 'URL không hợp lệ (cần http/https)' }));

/** Ảnh đã upload (Cloudinary): url hiển thị + publicId để xoá/thay ảnh. */
const imageSchema = z
  .object({
    url: httpUrlSchema,
    publicId: nullableText(255).default(null),
  })
  .nullable();

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 .()-]{6,20}$/, 'Số điện thoại không hợp lệ')
  .nullable()
  .or(z.literal('').transform(() => null));

const percentSchema = z
  .number('Phải là số')
  .min(0, 'Tối thiểu 0')
  .max(100, 'Tối đa 100')
  .refine((value) => Math.abs(Math.round(value * 100) - value * 100) < 1e-9, {
    message: 'Tối đa 2 chữ số thập phân',
  });

const timeSlotSchema = z
  .object({
    open: z.string().regex(OPEN_TIME_REGEX, 'Giờ mở cửa phải có dạng HH:mm (00:00-23:59)'),
    close: z.string().regex(CLOSE_TIME_REGEX, 'Giờ đóng cửa phải có dạng HH:mm (00:00-24:00)'),
  })
  .refine((slot) => timeToMinutes(slot.open) !== timeToMinutes(slot.close), {
    path: ['close'],
    message: 'Giờ đóng cửa phải khác giờ mở cửa',
  });

const dayOpeningHoursSchema = z.object({
  /** 0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7. */
  dayOfWeek: z.number().int().min(0).max(6),
  /** Mảng rỗng = nghỉ cả ngày. */
  slots: z.array(timeSlotSchema).max(6, 'Tối đa 6 khung giờ mỗi ngày').default([]),
});

export const openingHoursSchema = z
  .array(dayOpeningHoursSchema)
  .max(7)
  .superRefine((days, ctx) => {
    const seen = new Set<number>();
    days.forEach((day, index) => {
      if (seen.has(day.dayOfWeek)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'dayOfWeek'],
          message: 'Mỗi ngày trong tuần chỉ được khai báo một lần',
        });
      }
      seen.add(day.dayOfWeek);
    });
    if (seen.size !== days.length) return;

    const overlap = findOverlappingSlots(days);
    if (overlap) {
      const [, second] = overlap;
      const dayIndex = days.findIndex((day) => day.dayOfWeek === second.dayOfWeek);
      ctx.addIssue({
        code: 'custom',
        path: [dayIndex, 'slots', second.slotIndex],
        message: 'Khung giờ bị chồng lấn với khung giờ khác',
      });
    }
  })
  .transform((days) =>
    [...days]
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map((day) => ({
        dayOfWeek: day.dayOfWeek,
        slots: [...day.slots].sort((a, b) => timeToMinutes(a.open) - timeToMinutes(b.open)),
      })),
  );

const DEFAULT_OPENING_HOURS = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  slots: [{ open: '08:00', close: '22:00' }],
}));

const orderingSchema = z.object({
  /** Cho phép khách đặt món qua QR. */
  enabled: z.boolean().default(true),
  /** Đơn của khách cần nhân viên xác nhận trước khi chuyển bếp. */
  requireStaffConfirm: z.boolean().default(true),
  /** Cho phép đặt món ngoài giờ mở cửa. */
  allowOrderOutsideOpeningHours: z.boolean().default(false),
  /** Số lượng tối đa của một món trong một đơn. */
  maxItemQuantityPerOrder: z.number().int('Phải là số nguyên').min(1).max(1000).default(50),
});

const wifiSchema = z
  .object({
    ssid: z.string().trim().min(1, 'Vui lòng nhập tên Wi-Fi').max(64),
    password: nullableText(64).default(null),
  })
  .nullable();

const bankTransferInfoSchema = z
  .object({
    bankName: z.string().trim().min(1, 'Vui lòng nhập tên ngân hàng').max(100),
    accountNumber: z
      .string()
      .trim()
      .regex(/^[0-9]{4,30}$/, 'Số tài khoản chỉ gồm 4-30 chữ số'),
    accountName: z.string().trim().min(1, 'Vui lòng nhập tên chủ tài khoản').max(100),
  })
  .nullable();

/**
 * Toàn bộ cài đặt nhà hàng. Dùng cho:
 * - PUT /admin/settings (trường bị bỏ qua nhận giá trị mặc định),
 * - kiểm tra lại dữ liệu sau khi gộp PATCH,
 * - sinh document mặc định khi chưa có.
 */
export const restaurantSettingsSchema = z
  .object({
    name: z.string().trim().min(1, 'Vui lòng nhập tên nhà hàng').max(150),
    slogan: nullableText(200).default(null),
    description: nullableText(2000).default(null),
    logo: imageSchema.default(null),
    coverImage: imageSchema.default(null),
    address: nullableText(300).default(null),
    phone: phoneSchema.default(null),
    email: emailSchema
      .nullable()
      .or(z.literal('').transform(() => null))
      .default(null),
    wifi: wifiSchema.default(null),
    openingHours: openingHoursSchema.default(DEFAULT_OPENING_HOURS),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Mã tiền tệ gồm 3 chữ cái (ISO 4217)')
      .default('VND'),
    vatPercent: percentSchema.default(0),
    serviceChargePercent: percentSchema.default(0),
    ordering: orderingSchema.prefault({}),
    paymentMethods: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, 'Cần ít nhất một phương thức thanh toán')
      .refine((methods) => new Set(methods).size === methods.length, {
        message: 'Phương thức thanh toán bị trùng',
      })
      .default(['cash']),
    bankTransferInfo: bankTransferInfoSchema.default(null),
  })
  .superRefine((data, ctx) => {
    if (data.paymentMethods.includes('bank_transfer') && !data.bankTransferInfo) {
      ctx.addIssue({
        code: 'custom',
        path: ['bankTransferInfo'],
        message: 'Cần nhập thông tin chuyển khoản khi bật phương thức bank_transfer',
      });
    }
  });

export type RestaurantSettingsData = z.output<typeof restaurantSettingsSchema>;
export type RestaurantSettingsInput = z.input<typeof restaurantSettingsSchema>;

export const SETTINGS_FIELDS = Object.keys(
  restaurantSettingsSchema.shape,
) as (keyof RestaurantSettingsData)[];

/**
 * Body PATCH: chỉ kiểm tra là object có ít nhất một trường hợp lệ (trường lạ bị bỏ qua).
 * Kiểu dữ liệu chi tiết được kiểm tra sau khi gộp với cài đặt hiện tại bằng
 * `restaurantSettingsSchema` (để kiểm tra được ràng buộc chéo giữa các trường).
 */
export const patchSettingsSchema = z
  .record(z.string(), z.unknown())
  .transform((body) =>
    Object.fromEntries(
      Object.entries(body).filter(([key]) => (SETTINGS_FIELDS as string[]).includes(key)),
    ),
  )
  .refine((body) => Object.keys(body).length > 0, {
    message: `Cần ít nhất một trường để cập nhật: ${SETTINGS_FIELDS.join(', ')}`,
  });

export type PatchSettingsInput = Partial<Record<keyof RestaurantSettingsData, unknown>>;
