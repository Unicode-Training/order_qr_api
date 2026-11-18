import { model, Schema, type HydratedDocument, type Types } from 'mongoose';

export interface IUser {
  fullName: string;
  email: string;
  /** Hash bcrypt — `select: false`, KHÔNG BAO GIỜ trả ra API. */
  passwordHash: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true, index: true },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      // Phòng hờ: kể cả khi ai đó lỡ trả nguyên document, passwordHash vẫn bị loại bỏ.
      transform: (_doc, ret: Record<string, unknown>) => {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

export const User = model<IUser>('User', userSchema);

/** Dữ liệu user trả ra API (không có passwordHash). */
export interface PublicUser {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicUser(
  user: Pick<IUser, keyof Omit<IUser, 'passwordHash'>> & {
    _id: Types.ObjectId;
  },
): PublicUser {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
