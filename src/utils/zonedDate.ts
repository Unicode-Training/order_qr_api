import { RESTAURANT_TIMEZONE } from './openingHours';

/**
 * Tiện ích ngày/giờ theo múi giờ nhà hàng cho báo cáo.
 * Ngày được biểu diễn dạng chuỗi lịch "YYYY-MM-DD" (không phụ thuộc múi giờ máy chủ).
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Độ lệch (ms) của múi giờ so với UTC tại thời điểm `utcMs`. */
function offsetMs(utcMs: number, timeZone: string): number {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Ngày "YYYY-MM-DD" có hợp lệ theo lịch không (vd. 2026-02-30 là sai). */
export function isValidDateString(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parseDate(value: string): [number, number, number] {
  const match = DATE_RE.exec(value);
  if (!match) throw new Error(`Ngày không hợp lệ: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Thời điểm (UTC) ứng với giờ địa phương `date hour:00` tại múi giờ `timeZone`. */
export function zonedTimeToUtc(
  date: string,
  hour = 0,
  timeZone: string = RESTAURANT_TIMEZONE,
): Date {
  const [y, m, d] = parseDate(date);
  const guess = Date.UTC(y, m - 1, d, hour);
  let result = guess - offsetMs(guess, timeZone);
  // Hiệu chỉnh lần 2 cho múi giờ có DST (Asia/Ho_Chi_Minh không có, nhưng giữ cho đúng tổng quát).
  const corrected = guess - offsetMs(result, timeZone);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

/** Cộng `days` ngày vào ngày lịch "YYYY-MM-DD". */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Số ngày từ `from` tới `to` (to − from). */
export function diffDays(from: string, to: string): number {
  const [y1, m1, d1] = parseDate(from);
  const [y2, m2, d2] = parseDate(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** Khoảng [start, end) theo UTC phủ trọn các ngày lịch `from`..`to` (gồm cả hai đầu). */
export function zonedDayRange(
  from: string,
  to: string,
  timeZone: string = RESTAURANT_TIMEZONE,
): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(from, 0, timeZone),
    end: zonedTimeToUtc(addDays(to, 1), 0, timeZone),
  };
}
