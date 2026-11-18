/**
 * Tiện ích giờ mở cửa.
 *
 * Quy ước:
 * - `dayOfWeek`: 0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7 (giống `Date#getDay`).
 * - Khung giờ `{ open, close }` dạng "HH:mm" theo giờ địa phương của nhà hàng.
 *   `close` được phép là "24:00". Nếu `close <= open` thì khung giờ kéo qua nửa đêm
 *   sang ngày hôm sau (ví dụ 18:00-02:00). `open` không được bằng `close`.
 * - Thời điểm mở cửa tính theo nửa khoảng [open, close).
 */

export const RESTAURANT_TIMEZONE = 'Asia/Ho_Chi_Minh';

export const MINUTES_PER_DAY = 24 * 60;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

export interface TimeSlot {
  open: string;
  close: string;
}

export interface DayOpeningHours {
  dayOfWeek: number;
  slots: TimeSlot[];
}

/** Khoảng phút trên trục tuần [start, end), start ∈ [0, MINUTES_PER_WEEK), end có thể vượt tuần. */
export interface WeeklyInterval {
  start: number;
  end: number;
  dayOfWeek: number;
  slotIndex: number;
}

export const OPEN_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CLOSE_TIME_REGEX = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** "HH:mm" → số phút từ 00:00. Không validate — dùng sau khi đã kiểm tra regex. */
export function timeToMinutes(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** Chuyển các khung giờ trong tuần thành khoảng phút liên tục trên trục tuần. */
export function toWeeklyIntervals(openingHours: readonly DayOpeningHours[]): WeeklyInterval[] {
  const intervals: WeeklyInterval[] = [];
  for (const day of openingHours) {
    day.slots.forEach((slot, slotIndex) => {
      const open = timeToMinutes(slot.open);
      let close = timeToMinutes(slot.close);
      if (close <= open) close += MINUTES_PER_DAY; // qua nửa đêm
      const base = day.dayOfWeek * MINUTES_PER_DAY;
      intervals.push({
        start: base + open,
        end: base + close,
        dayOfWeek: day.dayOfWeek,
        slotIndex,
      });
    });
  }
  return intervals.sort((a, b) => a.start - b.start);
}

/**
 * Tìm cặp khung giờ chồng lấn nhau (kể cả khung qua nửa đêm và vòng từ Thứ 7 sang Chủ nhật).
 * Trả về cặp đầu tiên tìm thấy, hoặc `null` nếu không có.
 */
export function findOverlappingSlots(
  openingHours: readonly DayOpeningHours[],
): [WeeklyInterval, WeeklyInterval] | null {
  const intervals = toWeeklyIntervals(openingHours);
  for (let i = 1; i < intervals.length; i += 1) {
    const previous = intervals[i - 1]!;
    const current = intervals[i]!;
    if (current.start < previous.end) return [previous, current];
  }
  // Khung cuối tuần (Thứ 7) kéo sang Chủ nhật đầu tuần
  const first = intervals[0];
  const last = intervals[intervals.length - 1];
  if (first && last && first !== last && last.end - MINUTES_PER_WEEK > first.start) {
    return [last, first];
  }
  return null;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Thứ trong tuần và số phút từ 00:00 của thời điểm `date` theo múi giờ `timeZone`. */
export function getZonedWeekTime(
  date: Date,
  timeZone: string = RESTAURANT_TIMEZONE,
): { dayOfWeek: number; minutes: number } {
  const parts = getFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const dayOfWeek = WEEKDAY_INDEX[get('weekday')] ?? 0;
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return { dayOfWeek, minutes: hour * 60 + minute };
}

/** Nhà hàng có đang mở cửa tại thời điểm `date` (mặc định: bây giờ) không. */
export function isOpenAt(
  openingHours: readonly DayOpeningHours[],
  date: Date = new Date(),
  timeZone: string = RESTAURANT_TIMEZONE,
): boolean {
  const { dayOfWeek, minutes } = getZonedWeekTime(date, timeZone);
  const t = dayOfWeek * MINUTES_PER_DAY + minutes;
  return toWeeklyIntervals(openingHours).some(
    // t + tuần: khung qua nửa đêm của Thứ 7 phủ sang sáng Chủ nhật
    ({ start, end }) =>
      (t >= start && t < end) || (t + MINUTES_PER_WEEK >= start && t + MINUTES_PER_WEEK < end),
  );
}

/** Alias tiện dụng: đang mở cửa ngay lúc này theo giờ Asia/Ho_Chi_Minh. */
export function isOpenNow(
  openingHours: readonly DayOpeningHours[],
  now: Date = new Date(),
): boolean {
  return isOpenAt(openingHours, now, RESTAURANT_TIMEZONE);
}
