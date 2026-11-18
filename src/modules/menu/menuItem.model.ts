import { model, Schema, type HydratedDocument, type Types } from 'mongoose';
import { toSearchText } from '../../utils/slug';
import { imageSubSchema, type IImage } from './image.model';

export const MENU_ITEM_TAGS = [
  'bestseller',
  'new',
  'spicy',
  'vegetarian',
  'chef_recommend',
] as const;
export type MenuItemTag = (typeof MENU_ITEM_TAGS)[number];

export interface IMenuItemOption {
  _id: Types.ObjectId;
  name: string;
  /** Chênh lệch giá (VND, số nguyên, có thể âm) so với giá gốc của món. */
  priceDelta: number;
}

export interface IMenuItemOptionGroup {
  _id: Types.ObjectId;
  /** Ví dụ: "Mức chín", "Size". */
  name: string;
  /** Khách bắt buộc phải chọn ít nhất 1 lựa chọn. */
  required: boolean;
  /** Số lựa chọn tối đa được chọn trong nhóm. */
  maxSelect: number;
  options: IMenuItemOption[];
}

export interface IMenuItem {
  name: string;
  slug: string;
  description: string | null;
  categoryId: Types.ObjectId;
  /** Giá bán (VND, số nguyên). */
  price: number;
  /** Giá gốc trước giảm (tuỳ chọn, > price) để hiển thị giảm giá. */
  originalPrice: number | null;
  image: IImage | null;
  tags: MenuItemTag[];
  /** Còn món / hết món (món hết vẫn hiển thị cho khách nhưng không gọi được). */
  isAvailable: boolean;
  /** Hiện / ẩn khỏi thực đơn khách. */
  isActive: boolean;
  preparationTimeMinutes: number | null;
  sortOrder: number;
  optionGroups: IMenuItemOptionGroup[];
  /** Tên không dấu để tìm kiếm — nội bộ, không trả ra API. */
  searchName: string;
  createdAt: Date;
  updatedAt: Date;
}

export type MenuItemDocument = HydratedDocument<IMenuItem>;

const optionSchema = new Schema<IMenuItemOption>({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  priceDelta: { type: Number, default: 0 },
});

const optionGroupSchema = new Schema<IMenuItemOptionGroup>({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  required: { type: Boolean, default: false },
  maxSelect: { type: Number, default: 1, min: 1 },
  options: { type: [optionSchema], default: [] },
});

const menuItemSchema = new Schema<IMenuItem>(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: null, trim: true, maxlength: 1000 },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number, default: null, min: 0 },
    image: { type: imageSubSchema, default: null },
    tags: { type: [String], enum: MENU_ITEM_TAGS, default: [] },
    isAvailable: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    preparationTimeMinutes: { type: Number, default: null, min: 0 },
    sortOrder: { type: Number, default: 0 },
    optionGroups: { type: [optionGroupSchema], default: [] },
    searchName: { type: String, default: '' },
  },
  { timestamps: true },
);

menuItemSchema.index({ categoryId: 1, sortOrder: 1 });
menuItemSchema.index({ isActive: 1, isAvailable: 1 });
menuItemSchema.index({ tags: 1 });

menuItemSchema.pre('validate', function setSearchName() {
  if (this.isModified('name') || !this.searchName) this.searchName = toSearchText(this.name ?? '');
});

export const MenuItem = model<IMenuItem>('MenuItem', menuItemSchema);

export interface MenuItemOptionGroupDto {
  id: string;
  name: string;
  required: boolean;
  maxSelect: number;
  options: { id: string; name: string; priceDelta: number }[];
}

export interface MenuItemDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  categoryId: string;
  /** Thông tin tóm tắt danh mục (API admin). */
  category?: { id: string; name: string; slug: string } | null;
  price: number;
  originalPrice: number | null;
  /** % giảm giá làm tròn, null nếu không giảm. */
  discountPercent: number | null;
  image: IImage | null;
  tags: MenuItemTag[];
  isAvailable: boolean;
  isActive: boolean;
  preparationTimeMinutes: number | null;
  sortOrder: number;
  optionGroups: MenuItemOptionGroupDto[];
  createdAt: Date;
  updatedAt: Date;
}

/** Món trả cho khách: không có publicId ảnh, isActive, sortOrder, timestamps. */
export type PublicMenuItemDto = Omit<
  MenuItemDto,
  'image' | 'isActive' | 'sortOrder' | 'createdAt' | 'updatedAt' | 'category'
> & { image: { url: string } | null };

type MenuItemLike = Omit<IMenuItem, 'searchName'> & { _id: Types.ObjectId };
type PopulatedCategory = { _id: Types.ObjectId; name: string; slug: string };

function computeDiscountPercent(price: number, originalPrice: number | null): number | null {
  if (!originalPrice || originalPrice <= price) return null;
  return Math.round(((originalPrice - price) / originalPrice) * 100);
}

function isPopulatedCategory(value: unknown): value is PopulatedCategory {
  return typeof value === 'object' && value !== null && 'name' in value && '_id' in value;
}

export function toMenuItemDto(item: MenuItemLike): MenuItemDto {
  const rawCategory: unknown = item.categoryId;
  const category = isPopulatedCategory(rawCategory) ? rawCategory : null;
  const categoryId = category ? category._id.toString() : String(item.categoryId);
  return {
    id: item._id.toString(),
    name: item.name,
    slug: item.slug,
    description: item.description ?? null,
    categoryId,
    ...(category ? { category: { id: categoryId, name: category.name, slug: category.slug } } : {}),
    price: item.price,
    originalPrice: item.originalPrice ?? null,
    discountPercent: computeDiscountPercent(item.price, item.originalPrice ?? null),
    image: item.image ? { url: item.image.url, publicId: item.image.publicId ?? null } : null,
    tags: item.tags ?? [],
    isAvailable: item.isAvailable,
    isActive: item.isActive,
    preparationTimeMinutes: item.preparationTimeMinutes ?? null,
    sortOrder: item.sortOrder,
    optionGroups: (item.optionGroups ?? []).map((group) => ({
      id: group._id.toString(),
      name: group.name,
      required: group.required,
      maxSelect: group.maxSelect,
      options: group.options.map((option) => ({
        id: option._id.toString(),
        name: option.name,
        priceDelta: option.priceDelta,
      })),
    })),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function toPublicMenuItemDto(item: MenuItemLike): PublicMenuItemDto {
  const dto = toMenuItemDto(item);
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    description: dto.description,
    categoryId: dto.categoryId,
    price: dto.price,
    originalPrice: dto.originalPrice,
    discountPercent: dto.discountPercent,
    image: dto.image ? { url: dto.image.url } : null,
    tags: dto.tags,
    isAvailable: dto.isAvailable,
    preparationTimeMinutes: dto.preparationTimeMinutes,
    optionGroups: dto.optionGroups,
  };
}
