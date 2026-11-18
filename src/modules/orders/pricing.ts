import type { PricingConfig } from '../settings/settings.service';

/** Tổng tiền theo cấu hình VAT/phí phục vụ — dùng chung cho quote, đơn hàng, phiên bàn (và thanh toán sau này). */
export interface PriceBreakdown {
  currency: string;
  /** Tổng tiền món (đã gồm chênh lệch giá của lựa chọn). */
  subtotal: number;
  serviceChargePercent: number;
  /** Phí phục vụ = subtotal × serviceChargePercent. */
  serviceCharge: number;
  vatPercent: number;
  /** VAT tính trên (subtotal + phí phục vụ). */
  vatAmount: number;
  total: number;
}

/** Làm tròn tiền: VND (và các tiền tệ không có số lẻ) làm tròn tới đơn vị, còn lại tới 2 chữ số. */
export function roundMoney(amount: number, currency: string): number {
  const factor = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
  return Math.round(amount * factor) / factor;
}

const ZERO_DECIMAL_CURRENCIES = new Set(['VND', 'JPY', 'KRW']);

/**
 * Hàm tính tiền dùng chung.
 * - Phí phục vụ = subtotal × serviceChargePercent%
 * - VAT = (subtotal + phí phục vụ) × vatPercent%
 * - Mỗi khoản được làm tròn riêng; total = subtotal + phí phục vụ + VAT.
 */
export function calculateTotals(subtotal: number, config: PricingConfig): PriceBreakdown {
  const { currency, vatPercent, serviceChargePercent } = config;
  const roundedSubtotal = roundMoney(subtotal, currency);
  const serviceCharge = roundMoney((roundedSubtotal * serviceChargePercent) / 100, currency);
  const vatAmount = roundMoney(((roundedSubtotal + serviceCharge) * vatPercent) / 100, currency);
  return {
    currency,
    subtotal: roundedSubtotal,
    serviceChargePercent,
    serviceCharge,
    vatPercent,
    vatAmount,
    total: roundMoney(roundedSubtotal + serviceCharge + vatAmount, currency),
  };
}

export interface BillTotals extends PriceBreakdown {
  /** Tổng trước giảm giá = subtotal + phí phục vụ + VAT. */
  totalBeforeDiscount: number;
  /** Số tiền giảm (đã làm tròn), trừ vào tổng sau thuế/phí. */
  discountAmount: number;
  /** Tổng phải trả = totalBeforeDiscount − discountAmount (không âm). */
  total: number;
}

/**
 * Tổng hoá đơn khi thanh toán: tính như `calculateTotals`, sau đó trừ giảm giá (số tiền cố định,
 * áp lên tổng sau VAT/phí — giảm giá không làm thay đổi VAT/phí phục vụ đã tính).
 */
export function calculateBillTotals(
  subtotal: number,
  config: PricingConfig,
  discountAmount = 0,
): BillTotals {
  const base = calculateTotals(subtotal, config);
  const discount = Math.min(base.total, Math.max(0, roundMoney(discountAmount, config.currency)));
  return {
    ...base,
    totalBeforeDiscount: base.total,
    discountAmount: discount,
    total: roundMoney(base.total - discount, config.currency),
  };
}
