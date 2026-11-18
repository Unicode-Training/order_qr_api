import { z } from 'zod';
import { objectIdSchema } from '../../utils/objectId';
import { paginationQuerySchema } from '../../utils/pagination';
import { SLUG_PATTERN } from '../../utils/slug';
import { MENU_ITEM_TAGS } from './menuItem.model';

const MAX_PRICE = 1_000_000_000;

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value === '' ? null : value));

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(120)
  .regex(SLUG_PATTERN, 'Slug chỉ gồm chữ thường không dấu, số và dấu gạch ngang');

/** Ảnh đã upload (lấy từ kết quả POST /admin/uploads). `null` để gỡ ảnh. */
export const imageInputSchema = z
  .object({
    url: z.url({ protocol: /^https?$/, error: 'URL ảnh không hợp lệ' }),
    publicId: z.string().trim().min(1).max(255).nullable().default(null),
  })
  .nullable();

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const sortOrderSchema = z.number().int().min(-1_000_000).max(1_000_000);

const atLeastOneField = <T extends Record<string, unknown>>(data: T) =>
  Object.values(data).some((value) => value !== undefined);
const atLeastOneFieldMessage = { message: 'Cần ít nhất một trường để cập nhật' };

// ---------------------------------------------------------------- Categories

const categoryFields = {
  name: z.string().trim().min(1, 'Vui lòng nhập tên danh mục').max(100),
  slug: slugSchema,
  description: nullableText(500),
  icon: nullableText(100),
  image: imageInputSchema,
  sortOrder: sortOrderSchema,
  isActive: z.boolean(),
};

export const createCategorySchema = z.object({
  name: categoryFields.name,
  slug: categoryFields.slug.optional(),
  description: categoryFields.description.default(null),
  icon: categoryFields.icon.default(null),
  image: categoryFields.image.default(null),
  /** Bỏ trống → xếp cuối danh sách. */
  sortOrder: categoryFields.sortOrder.optional(),
  isActive: categoryFields.isActive.default(true),
});

export const updateCategorySchema = z
  .object(categoryFields)
  .partial()
  .refine(atLeastOneField, atLeastOneFieldMessage);

export const listCategoriesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  isActive: booleanQuery,
});

/** Sắp xếp lại: gửi danh sách {id, sortOrder} của các phần tử cần đổi thứ tự. */
export const reorderSchema = z.object({
  items: z
    .array(z.object({ id: objectIdSchema, sortOrder: sortOrderSchema }))
    .min(1, 'Cần ít nhất một phần tử')
    .max(500)
    .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
      message: 'Danh sách có id bị trùng',
    }),
});

// ---------------------------------------------------------------- Menu items

const priceSchema = z
  .number()
  .int('Giá phải là số nguyên (VND)')
  .min(0, 'Giá không được âm')
  .max(MAX_PRICE);

const tagsSchema = z
  .array(z.enum(MENU_ITEM_TAGS))
  .max(MENU_ITEM_TAGS.length)
  .transform((tags) => [...new Set(tags)]);

const optionSchema = z.object({
  name: z.string().trim().min(1, 'Vui lòng nhập tên lựa chọn').max(100),
  priceDelta: z
    .number()
    .int('Chênh lệch giá phải là số nguyên (VND)')
    .min(-MAX_PRICE)
    .max(MAX_PRICE)
    .default(0),
});

const optionGroupSchema = z
  .object({
    name: z.string().trim().min(1, 'Vui lòng nhập tên nhóm lựa chọn').max(100),
    required: z.boolean().default(false),
    maxSelect: z.number().int().min(1).max(50).default(1),
    options: z.array(optionSchema).min(1, 'Nhóm lựa chọn cần ít nhất một lựa chọn').max(50),
  })
  .superRefine((group, ctx) => {
    if (group.maxSelect > group.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxSelect'],
        message: 'maxSelect không được lớn hơn số lựa chọn',
      });
    }
    const names = group.options.map((option) => option.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Tên lựa chọn bị trùng' });
    }
  });

const optionGroupsSchema = z
  .array(optionGroupSchema)
  .max(20)
  .refine((groups) => new Set(groups.map((g) => g.name.toLowerCase())).size === groups.length, {
    message: 'Tên nhóm lựa chọn bị trùng',
  });

const menuItemFields = {
  name: z.string().trim().min(1, 'Vui lòng nhập tên món').max(150),
  slug: slugSchema,
  description: nullableText(1000),
  categoryId: objectIdSchema,
  price: priceSchema,
  originalPrice: priceSchema.nullable(),
  image: imageInputSchema,
  tags: tagsSchema,
  isAvailable: z.boolean(),
  isActive: z.boolean(),
  preparationTimeMinutes: z.number().int().min(0).max(600).nullable(),
  sortOrder: sortOrderSchema,
  optionGroups: optionGroupsSchema,
};

const originalPriceRule = {
  message: 'Giá gốc (originalPrice) phải lớn hơn giá bán',
  path: ['originalPrice'],
};

export const createMenuItemSchema = z
  .object({
    name: menuItemFields.name,
    slug: menuItemFields.slug.optional(),
    description: menuItemFields.description.default(null),
    categoryId: menuItemFields.categoryId,
    price: menuItemFields.price,
    originalPrice: menuItemFields.originalPrice.default(null),
    image: menuItemFields.image.default(null),
    tags: menuItemFields.tags.default([]),
    isAvailable: menuItemFields.isAvailable.default(true),
    isActive: menuItemFields.isActive.default(true),
    preparationTimeMinutes: menuItemFields.preparationTimeMinutes.default(null),
    /** Bỏ trống → xếp cuối danh mục. */
    sortOrder: menuItemFields.sortOrder.optional(),
    optionGroups: menuItemFields.optionGroups.default([]),
  })
  .refine(
    (data) => data.originalPrice === null || data.originalPrice > data.price,
    originalPriceRule,
  );

/** Ràng buộc originalPrice > price được kiểm tra lại trong service sau khi gộp với dữ liệu cũ. */
export const updateMenuItemSchema = z
  .object(menuItemFields)
  .partial()
  .refine(atLeastOneField, atLeastOneFieldMessage);

export const availabilitySchema = z.object({ isAvailable: z.boolean() });

const tagsQuery = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((part) => part.split(','))
      .map((part) => part.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(MENU_ITEM_TAGS)))
  .optional();

export const listMenuItemsQuerySchema = paginationQuerySchema.extend({
  /** Tìm theo tên món (không phân biệt hoa thường, hỗ trợ không dấu). */
  search: z.string().trim().max(100).optional(),
  categoryId: objectIdSchema.optional(),
  isAvailable: booleanQuery,
  isActive: booleanQuery,
  /** Lọc món có ít nhất một trong các tag (phân tách bằng dấu phẩy). */
  tags: tagsQuery,
});

export const publicMenuQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  /** id hoặc slug của danh mục. */
  category: z.string().trim().min(1).max(120).optional(),
  tag: z.enum(MENU_ITEM_TAGS).optional(),
});

export const publicMenuItemParamsSchema = z.object({
  /** id hoặc slug của món. */
  id: z.string().trim().min(1).max(120),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
export type ReorderInput = z.infer<typeof reorderSchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
export type ListMenuItemsQuery = z.infer<typeof listMenuItemsQuerySchema>;
export type PublicMenuQuery = z.infer<typeof publicMenuQuerySchema>;
