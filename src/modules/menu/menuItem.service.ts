import type { QueryFilter } from 'mongoose';
import { AppError } from '../../utils/AppError';
import {
  buildPaginationMeta,
  getPaginationOptions,
  type PaginationMeta,
} from '../../utils/pagination';
import { escapeRegex, generateUniqueSlug, toSearchText } from '../../utils/slug';
import { cleanupReplacedImage, deleteImageQuietly } from '../uploads/image.cleanup';
import { Category } from './category.model';
import type {
  CreateMenuItemInput,
  ListMenuItemsQuery,
  ReorderInput,
  UpdateMenuItemInput,
} from './menu.schema';
import { MenuItem, toMenuItemDto, type IMenuItem, type MenuItemDto } from './menuItem.model';

const SORT_FIELDS = ['sortOrder', 'name', 'price', 'createdAt', 'updatedAt'] as const;
const CATEGORY_POPULATE = { path: 'categoryId', select: 'name slug' } as const;

export interface MenuStats {
  /** Tổng số món (kể cả đang ẩn). */
  totalItems: number;
  /** Đang bán: hiển thị và còn món. */
  availableItems: number;
  /** Hết món (đang hiển thị nhưng isAvailable=false). */
  outOfStockItems: number;
  /** Món đang ẩn (isActive=false). */
  hiddenItems: number;
  totalCategories: number;
  activeCategories: number;
}

/** Điều kiện tìm theo tên (có dấu hoặc không dấu). */
export function buildNameSearchFilter(search: string): QueryFilter<IMenuItem> {
  return {
    $or: [
      { name: new RegExp(escapeRegex(search), 'i') },
      { searchName: new RegExp(escapeRegex(toSearchText(search)), 'i') },
    ],
  };
}

async function findItemOrThrow(id: string) {
  const item = await MenuItem.findById(id);
  if (!item) throw AppError.notFound('Không tìm thấy món');
  return item;
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  if (!(await Category.exists({ _id: categoryId }))) {
    throw new AppError(400, 'CATEGORY_NOT_FOUND', 'Danh mục không tồn tại', { categoryId });
  }
}

async function assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
  const existing = await MenuItem.exists({
    slug,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (existing) throw new AppError(409, 'SLUG_TAKEN', 'Slug món đã được sử dụng', { slug });
}

function assertOriginalPrice(price: number, originalPrice: number | null): void {
  if (originalPrice !== null && originalPrice <= price) {
    throw AppError.validation('Dữ liệu không hợp lệ', [
      {
        location: 'body',
        path: 'originalPrice',
        message: 'Giá gốc (originalPrice) phải lớn hơn giá bán',
        code: 'custom',
      },
    ]);
  }
}

async function nextSortOrder(categoryId: string): Promise<number> {
  const last = await MenuItem.findOne({ categoryId })
    .sort({ sortOrder: -1 })
    .select('sortOrder')
    .lean();
  return last ? last.sortOrder + 1 : 0;
}

async function toDtoWithCategory(id: unknown): Promise<MenuItemDto> {
  const item = await MenuItem.findById(id).populate(CATEGORY_POPULATE).lean();
  if (!item) throw AppError.notFound('Không tìm thấy món');
  return toMenuItemDto(item);
}

export async function listMenuItems(
  query: ListMenuItemsQuery,
): Promise<{ items: MenuItemDto[]; meta: PaginationMeta }> {
  const { page, limit, skip, sort } = getPaginationOptions(query, {
    allowedSortFields: SORT_FIELDS,
    defaultSort: { sortOrder: 1, createdAt: -1 },
  });

  const filter: QueryFilter<IMenuItem> = {};
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.isAvailable !== undefined) filter.isAvailable = query.isAvailable;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.tags?.length) filter.tags = { $in: query.tags };
  if (query.search) Object.assign(filter, buildNameSearchFilter(query.search));

  const [items, total] = await Promise.all([
    MenuItem.find(filter)
      .sort({ ...sort, _id: 1 })
      .skip(skip)
      .limit(limit)
      .populate(CATEGORY_POPULATE)
      .lean(),
    MenuItem.countDocuments(filter),
  ]);
  return { items: items.map(toMenuItemDto), meta: buildPaginationMeta(total, page, limit) };
}

export async function getMenuItem(id: string): Promise<MenuItemDto> {
  return toDtoWithCategory(id);
}

export async function createMenuItem(input: CreateMenuItemInput): Promise<MenuItemDto> {
  await assertCategoryExists(input.categoryId);
  let slug: string;
  if (input.slug) {
    await assertSlugAvailable(input.slug);
    slug = input.slug;
  } else {
    slug = await generateUniqueSlug(input.name, async (s) =>
      Boolean(await MenuItem.exists({ slug: s })),
    );
  }
  const item = await MenuItem.create({
    ...input,
    slug,
    sortOrder: input.sortOrder ?? (await nextSortOrder(input.categoryId)),
  });
  return toDtoWithCategory(item._id);
}

export async function updateMenuItem(id: string, input: UpdateMenuItemInput): Promise<MenuItemDto> {
  const item = await findItemOrThrow(id);
  const previousImage = item.image ? { url: item.image.url, publicId: item.image.publicId } : null;

  assertOriginalPrice(
    input.price ?? item.price,
    input.originalPrice !== undefined ? input.originalPrice : item.originalPrice,
  );
  if (input.categoryId !== undefined && input.categoryId !== item.categoryId.toString()) {
    await assertCategoryExists(input.categoryId);
  }
  if (input.slug !== undefined && input.slug !== item.slug) {
    await assertSlugAvailable(input.slug, id);
  }
  for (const [field, value] of Object.entries(input)) {
    if (value !== undefined) item.set(field, value);
  }
  await item.save();

  if (input.image !== undefined) cleanupReplacedImage(previousImage, item.image);
  return toDtoWithCategory(item._id);
}

export async function setAvailability(id: string, isAvailable: boolean): Promise<MenuItemDto> {
  const item = await MenuItem.findByIdAndUpdate(
    id,
    { $set: { isAvailable } },
    { returnDocument: 'after', runValidators: true },
  )
    .populate(CATEGORY_POPULATE)
    .lean();
  if (!item) throw AppError.notFound('Không tìm thấy món');
  return toMenuItemDto(item);
}

/** Xoá hẳn món và xoá ảnh trên Cloudinary (lỗi xoá ảnh chỉ ghi log). */
export async function deleteMenuItem(id: string): Promise<void> {
  const item = await findItemOrThrow(id);
  await item.deleteOne();
  deleteImageQuietly(item.image?.publicId);
}

export async function reorderMenuItems(input: ReorderInput): Promise<void> {
  const ids = input.items.map((item) => item.id);
  const found = await MenuItem.find({ _id: { $in: ids } })
    .select('_id')
    .lean();
  if (found.length !== ids.length) {
    const existing = new Set(found.map((i) => i._id.toString()));
    throw AppError.notFound('Không tìm thấy món', {
      missingIds: ids.filter((itemId) => !existing.has(itemId)),
    });
  }
  await MenuItem.bulkWrite(
    input.items.map((item) => ({
      updateOne: { filter: { _id: item.id }, update: { $set: { sortOrder: item.sortOrder } } },
    })),
  );
}

/** Số liệu cho header màn "Quản lý Thực đơn". */
export async function getMenuStats(): Promise<MenuStats> {
  const [
    totalItems,
    availableItems,
    outOfStockItems,
    hiddenItems,
    totalCategories,
    activeCategories,
  ] = await Promise.all([
    MenuItem.countDocuments(),
    MenuItem.countDocuments({ isActive: true, isAvailable: true }),
    MenuItem.countDocuments({ isActive: true, isAvailable: false }),
    MenuItem.countDocuments({ isActive: false }),
    Category.countDocuments(),
    Category.countDocuments({ isActive: true }),
  ]);
  return {
    totalItems,
    availableItems,
    outOfStockItems,
    hiddenItems,
    totalCategories,
    activeCategories,
  };
}
