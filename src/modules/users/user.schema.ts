import { z } from 'zod';
import { emailSchema, passwordSchema } from '../auth/auth.schema';
import { paginationQuerySchema } from '../../utils/pagination';

const fullNameSchema = z.string().trim().min(1, 'Vui lòng nhập họ tên').max(100);

export const listUsersQuerySchema = paginationQuerySchema.extend({
  /** Tìm theo họ tên hoặc email (không phân biệt hoa thường). */
  search: z.string().trim().max(100).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const createUserSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const updateUserSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    isActive: z.boolean(),
    /** Đặt lại mật khẩu cho tài khoản (thu hồi mọi phiên đăng nhập của tài khoản đó). */
    password: passwordSchema,
  })
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Cần ít nhất một trường để cập nhật',
  });

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
