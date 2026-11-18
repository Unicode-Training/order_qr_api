import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

/** Khu vực / tầng của nhà hàng, ví dụ "Tầng 1 - Sảnh chính". */
export interface IArea {
  name: string;
  /** Thứ tự hiển thị (tăng dần). */
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export type AreaDocument = HydratedDocument<IArea>;

const areaSchema = new Schema<IArea>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

areaSchema.index({ sortOrder: 1, name: 1 });

export const Area = model<IArea>('Area', areaSchema);

export interface AreaDto {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toAreaDto(area: IArea & { _id: Types.ObjectId }): AreaDto {
  return {
    id: area._id.toString(),
    name: area.name,
    sortOrder: area.sortOrder,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
  };
}
