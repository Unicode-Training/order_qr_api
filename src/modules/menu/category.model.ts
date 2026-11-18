import { model, Schema, type HydratedDocument, type Types } from 'mongoose';
import { toSearchText } from '../../utils/slug';
import { imageSubSchema, type IImage } from './image.model';

export interface ICategory {
  name: string;
  slug: string;
  description: string | null;
  /** Icon (emoji hoặc tên icon phía frontend). */
  icon: string | null;
  image: IImage | null;
  sortOrder: number;
  isActive: boolean;
  /** Tên không dấu để tìm kiếm — nội bộ, không trả ra API. */
  searchName: string;
  createdAt: Date;
  updatedAt: Date;
}

export type CategoryDocument = HydratedDocument<ICategory>;

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    icon: { type: String, default: null, trim: true, maxlength: 100 },
    image: { type: imageSubSchema, default: null },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    searchName: { type: String, default: '' },
  },
  { timestamps: true },
);

categorySchema.index({ isActive: 1, sortOrder: 1 });

categorySchema.pre('validate', function setSearchName() {
  if (this.isModified('name') || !this.searchName) this.searchName = toSearchText(this.name ?? '');
});

export const Category = model<ICategory>('Category', categorySchema);

export interface CategoryDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  image: IImage | null;
  sortOrder: number;
  isActive: boolean;
  /** Số món thuộc danh mục (chỉ có ở API admin). */
  itemCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

type CategoryLike = Omit<ICategory, 'searchName'> & { _id: Types.ObjectId };

export function toCategoryDto(category: CategoryLike, itemCount?: number): CategoryDto {
  return {
    id: category._id.toString(),
    name: category.name,
    slug: category.slug,
    description: category.description ?? null,
    icon: category.icon ?? null,
    image: category.image
      ? { url: category.image.url, publicId: category.image.publicId ?? null }
      : null,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    ...(itemCount !== undefined ? { itemCount } : {}),
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}
