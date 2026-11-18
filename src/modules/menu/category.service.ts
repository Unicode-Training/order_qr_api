import type { QueryFilter, Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { escapeRegex, generateUniqueSlug, toSearchText } from '../../utils/slug';
import { cleanupReplacedImage, deleteImageQuietly } from '../uploads/image.cleanup';
import { Category, toCategoryDto, type CategoryDto, type ICategory } from './category.model';
import type {
  CreateCategoryInput,
  ListCategoriesQuery,
  ReorderInput,
  UpdateCategoryInput,
} from './menu.schema';
import { MenuItem } from './menuItem.model';

export const CATEGORY_SORT = { sortOrder: 1, name: 1 } as const;

/** Số món theo từng danh mục: Map<categoryId, count>. */
async function countItemsByCategory(categoryIds?: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await MenuItem.aggregate<{ _id: Types.ObjectId; count: number }>([
    ...(categoryIds ? [{ $match: { categoryId: { $in: categoryIds } } }] : []),
    { $group: { _id: '$categoryId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}

async function findCategoryOrThrow(id: string) {
  const category = await Category.findById(id);
  if (!category) throw AppError.notFound('Không tìm thấy danh mục');
  return category;
}

async function assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
  const existing = await Category.exists({
    slug,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (existing) throw new AppError(409, 'SLUG_TAKEN', 'Slug danh mục đã được sử dụng', { slug });
}

async function nextSortOrder(): Promise<number> {
  const last = await Category.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
  return last ? last.sortOrder + 1 : 0;
}

export async function listCategories(query: ListCategoriesQuery): Promise<CategoryDto[]> {
  const filter: QueryFilter<ICategory> = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    filter.$or = [
      { name: new RegExp(escapeRegex(query.search), 'i') },
      { searchName: new RegExp(escapeRegex(toSearchText(query.search)), 'i') },
    ];
  }
  const categories = await Category.find(filter).sort(CATEGORY_SORT).lean();
  const counts = await countItemsByCategory(categories.map((c) => c._id));
  return categories.map((c) => toCategoryDto(c, counts.get(c._id.toString()) ?? 0));
}

export async function getCategory(id: string): Promise<CategoryDto> {
  const category = await findCategoryOrThrow(id);
  const itemCount = await MenuItem.countDocuments({ categoryId: category._id });
  return toCategoryDto(category, itemCount);
}

export async function createCategory(input: CreateCategoryInput): Promise<CategoryDto> {
  let slug: string;
  if (input.slug) {
    await assertSlugAvailable(input.slug);
    slug = input.slug;
  } else {
    slug = await generateUniqueSlug(input.name, async (s) =>
      Boolean(await Category.exists({ slug: s })),
    );
  }
  const category = await Category.create({
    ...input,
    slug,
    sortOrder: input.sortOrder ?? (await nextSortOrder()),
  });
  return toCategoryDto(category, 0);
}

export async function updateCategory(id: string, input: UpdateCategoryInput): Promise<CategoryDto> {
  const category = await findCategoryOrThrow(id);
  const previousImage = category.image
    ? { url: category.image.url, publicId: category.image.publicId }
    : null;

  if (input.slug !== undefined && input.slug !== category.slug) {
    await assertSlugAvailable(input.slug, id);
  }
  for (const [field, value] of Object.entries(input)) {
    if (value !== undefined) category.set(field, value);
  }
  await category.save();

  if (input.image !== undefined) cleanupReplacedImage(previousImage, category.image);
  const itemCount = await MenuItem.countDocuments({ categoryId: category._id });
  return toCategoryDto(category, itemCount);
}

/** Không cho xoá danh mục còn món (409 CATEGORY_NOT_EMPTY) — hãy chuyển món hoặc ẩn danh mục. */
export async function deleteCategory(id: string): Promise<void> {
  const category = await findCategoryOrThrow(id);
  const itemCount = await MenuItem.countDocuments({ categoryId: category._id });
  if (itemCount > 0) {
    throw new AppError(
      409,
      'CATEGORY_NOT_EMPTY',
      'Danh mục vẫn còn món, hãy chuyển hoặc xoá các món trước (hoặc ẩn danh mục)',
      { itemCount },
    );
  }
  await category.deleteOne();
  deleteImageQuietly(category.image?.publicId);
}

export async function reorderCategories(input: ReorderInput): Promise<CategoryDto[]> {
  const ids = input.items.map((item) => item.id);
  const found = await Category.find({ _id: { $in: ids } })
    .select('_id')
    .lean();
  if (found.length !== ids.length) {
    const existing = new Set(found.map((c) => c._id.toString()));
    throw AppError.notFound('Không tìm thấy danh mục', {
      missingIds: ids.filter((id) => !existing.has(id)),
    });
  }
  await Category.bulkWrite(
    input.items.map((item) => ({
      updateOne: { filter: { _id: item.id }, update: { $set: { sortOrder: item.sortOrder } } },
    })),
  );
  return listCategories({});
}
