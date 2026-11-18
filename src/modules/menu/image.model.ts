import { Schema } from 'mongoose';

/** Ảnh đã upload lên Cloudinary: `url` để hiển thị, `publicId` để xoá/thay ảnh. */
export interface IImage {
  url: string;
  publicId: string | null;
}

export const imageSubSchema = new Schema<IImage>(
  {
    url: { type: String, required: true, trim: true },
    publicId: { type: String, default: null, trim: true },
  },
  { _id: false },
);
