import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Tối đa ${max} ký tự`)
    .nullish()
    .transform((value) => value || null);

const guestCountSchema = z.number('Phải là số').int('Phải là số nguyên').min(1).max(100);

export const openSessionSchema = z.object({
  qrToken: z.string().trim().min(1, 'Thiếu mã QR').max(200),
  guestCount: guestCountSchema.optional(),
  customerName: optionalText(100),
  note: optionalText(500),
});

export const updateSessionSchema = z
  .object({
    guestCount: guestCountSchema.optional(),
    customerName: optionalText(100).optional(),
    note: optionalText(500).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Cần ít nhất một trường: guestCount, customerName, note',
  });

export type OpenSessionInput = z.output<typeof openSessionSchema>;
export type UpdateSessionInput = z.output<typeof updateSessionSchema>;
