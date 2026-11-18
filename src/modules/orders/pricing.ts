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
function roundMoney(amount: number, currency: string): number {
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
