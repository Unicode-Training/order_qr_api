import { isValidObjectId, type QueryFilter } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { Category, type ICategory } from './category.model';
import type { PublicMenuQuery } from './menu.schema';
import {
  MenuItem,
  toPublicMenuItemDto,
  type IMenuItem,
  type PublicMenuItemDto,
} from './menuItem.model';
import { buildNameSearchFilter } from './menuItem.service';
import { CATEGORY_SORT } from './category.service';

const ITEM_SORT = { sortOrder: 1, name: 1, _id: 1 } as const;

export interface PublicCategoryDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  image: { url: string } | null;
}

export interface PublicMenu {
  categories: (PublicCategoryDto & { items: PublicMenuItemDto[] })[];
  totalItems: number;
}

function toPublicCategory(
  category: ICategory & { _id: { toString(): string } },
): PublicCategoryDto {
  return {
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    description: category.description ?? null,
    icon: category.icon ?? null,
    image: category.image ? { url: category.image.url } : null,
  };
}

/** Điều kiện tìm theo id hoặc slug. */
function idOrSlug(value: string): Record<string, unknown> {
  return isValidObjectId(value) && /^[a-f\d]{24}$/i.test(value)
    ? { $or: [{ _id: value }, { slug: value.toLowerCase() }] }
    : { slug: value.toLowerCase() };
}

/**
 * Thực đơn cho khách: danh mục active (theo sortOrder) kèm món active (theo sortOrder).
 * Món hết hàng vẫn trả về với `isAvailable=false`. Khi có bộ lọc, danh mục không còn món nào bị bỏ.
 */
export async function getPublicMenu(query: PublicMenuQuery): Promise<PublicMenu> {
  const categoryFilter: QueryFilter<ICategory> = { isActive: true };
  if (query.category) Object.assign(categoryFilter, idOrSlug(query.category));
  const categories = await Category.find(categoryFilter).sort(CATEGORY_SORT).lean();

  const itemFilter: QueryFilter<IMenuItem> = {
    isActive: true,
    categoryId: { $in: categories.map((c) => c._id) },
  };
  if (query.tag) itemFilter.tags = query.tag;
  if (query.search) Object.assign(itemFilter, buildNameSearchFilter(query.search));
  const items = categories.length ? await MenuItem.find(itemFilter).sort(ITEM_SORT).lean() : [];

  const itemsByCategory = new Map<string, PublicMenuItemDto[]>();
  for (const item of items) {
    const key = item.categoryId.toString();
    const list = itemsByCategory.get(key) ?? [];
    list.push(toPublicMenuItemDto(item));
    itemsByCategory.set(key, list);
  }

  const filtering = Boolean(query.search || query.tag);
  const result = categories
    .map((category) => ({
      ...toPublicCategory(category),
      items: itemsByCategory.get(category._id.toString()) ?? [],
    }))
    .filter((category) => !filtering || category.items.length > 0);

  return { categories: result, totalItems: items.length };
}

/** Chi tiết món cho khách (theo id hoặc slug) — 404 nếu món hoặc danh mục đang ẩn. */
export async function getPublicMenuItem(
  idOrSlugValue: string,
): Promise<PublicMenuItemDto & { category: PublicCategoryDto }> {
  const item = await MenuItem.findOne({ isActive: true, ...idOrSlug(idOrSlugValue) }).lean();
  const category = item
    ? await Category.findOne({ _id: item.categoryId, isActive: true }).lean()
    : null;
  if (!item || !category) throw AppError.notFound('Không tìm thấy món');
  return { ...toPublicMenuItemDto(item), category: toPublicCategory(category) };
}
