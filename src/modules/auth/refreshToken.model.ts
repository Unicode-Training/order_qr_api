import { model, Schema, type Types } from 'mongoose';

/**
 * Refresh token đã cấp. Chỉ lưu SHA-256 của token (không lưu token gốc).
 * Token bị thu hồi khi logout, khi được dùng để refresh (rotation), khi đổi mật khẩu
 * hoặc khi tài khoản bị vô hiệu hoá. Document tự xoá khi hết hạn (TTL index).
 */
export interface IRefreshToken {
  user: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<IRefreshToken>('RefreshToken', refreshTokenSchema);
