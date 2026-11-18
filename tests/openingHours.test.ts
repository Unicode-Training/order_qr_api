import { describe, expect, it } from 'vitest';
import {
  findOverlappingSlots,
  getZonedWeekTime,
  isOpenAt,
  isOpenNow,
  type DayOpeningHours,
} from '../src/utils/openingHours';

/** Thời điểm theo giờ Việt Nam (UTC+7). 2026-11-18 là Thứ 4, 2026-11-21 Thứ 7, 2026-11-22 Chủ nhật. */
const vn = (local: string) => new Date(`${local}+07:00`);

const lunchAndDinner: DayOpeningHours[] = [
  {
    dayOfWeek: 3,
    slots: [
      { open: '10:30', close: '14:00' },
      { open: '17:30', close: '23:00' },
    ],
  },
];

describe('getZonedWeekTime', () => {
  it('quy đổi sang giờ Asia/Ho_Chi_Minh bất kể giờ hệ thống', () => {
    // 2026-11-17T20:00Z = 03:00 Thứ 4 ở Việt Nam
    expect(getZonedWeekTime(new Date('2026-11-17T20:00:00Z'))).toEqual({
      dayOfWeek: 3,
      minutes: 180,
    });
    expect(getZonedWeekTime(vn('2026-11-22T00:00:00'))).toEqual({ dayOfWeek: 0, minutes: 0 });
  });
});

describe('isOpenAt / isOpenNow', () => {
  it.each([
    ['2026-11-18T10:29:00', false],
    ['2026-11-18T10:30:00', true],
    ['2026-11-18T13:59:00', true],
    ['2026-11-18T14:00:00', false], // giờ đóng cửa không tính là mở
    ['2026-11-18T15:00:00', false],
    ['2026-11-18T17:30:00', true],
    ['2026-11-18T22:59:00', true],
    ['2026-11-18T23:00:00', false],
    ['2026-11-19T12:00:00', false], // Thứ 5 không khai báo → nghỉ
  ])('nhiều khung giờ trong ngày: %s → %s', (local, expected) => {
    expect(isOpenAt(lunchAndDinner, vn(local))).toBe(expected);
  });

  it('dùng múi giờ Việt Nam: 04:00Z = 11:00 VN là đang mở', () => {
    expect(isOpenNow(lunchAndDinner, new Date('2026-11-18T04:00:00Z'))).toBe(true);
    // Cùng thời điểm theo UTC thì đang 04:00 → nếu tính sai múi giờ sẽ ra "đóng"
    expect(isOpenAt(lunchAndDinner, new Date('2026-11-18T04:00:00Z'), 'UTC')).toBe(false);
  });

  it('khung giờ qua nửa đêm (18:00-02:00) mở sang rạng sáng hôm sau', () => {
    const hours: DayOpeningHours[] = [{ dayOfWeek: 3, slots: [{ open: '18:00', close: '02:00' }] }];
    expect(isOpenAt(hours, vn('2026-11-18T23:30:00'))).toBe(true);
    expect(isOpenAt(hours, vn('2026-11-19T01:59:00'))).toBe(true);
    expect(isOpenAt(hours, vn('2026-11-19T02:00:00'))).toBe(false);
    expect(isOpenAt(hours, vn('2026-11-18T01:00:00'))).toBe(false);
  });

  it('khung qua nửa đêm của Thứ 7 phủ sang sáng Chủ nhật', () => {
    const hours: DayOpeningHours[] = [{ dayOfWeek: 6, slots: [{ open: '20:00', close: '03:00' }] }];
    expect(isOpenAt(hours, vn('2026-11-22T02:00:00'))).toBe(true);
    expect(isOpenAt(hours, vn('2026-11-22T03:00:00'))).toBe(false);
  });

  it('close = 24:00 mở đến hết ngày; ngày có slots rỗng là nghỉ', () => {
    const hours: DayOpeningHours[] = [
      { dayOfWeek: 0, slots: [] },
      { dayOfWeek: 3, slots: [{ open: '00:00', close: '24:00' }] },
    ];
    expect(isOpenAt(hours, vn('2026-11-18T00:00:00'))).toBe(true);
    expect(isOpenAt(hours, vn('2026-11-18T23:59:00'))).toBe(true);
    expect(isOpenAt(hours, vn('2026-11-19T00:00:00'))).toBe(false);
    expect(isOpenAt(hours, vn('2026-11-22T12:00:00'))).toBe(false);
  });

  it('không có giờ mở cửa → luôn đóng', () => {
    expect(isOpenNow([])).toBe(false);
  });
});

describe('findOverlappingSlots', () => {
  it('không chồng lấn khi khung sau bắt đầu đúng lúc khung trước kết thúc', () => {
    expect(
      findOverlappingSlots([
        {
          dayOfWeek: 1,
          slots: [
            { open: '08:00', close: '12:00' },
            { open: '12:00', close: '14:00' },
          ],
        },
      ]),
    ).toBeNull();
  });

  it('phát hiện chồng lấn trong ngày, qua nửa đêm và từ Thứ 7 sang Chủ nhật', () => {
    expect(
      findOverlappingSlots([
        {
          dayOfWeek: 1,
          slots: [
            { open: '08:00', close: '12:00' },
            { open: '11:00', close: '14:00' },
          ],
        },
      ]),
    ).not.toBeNull();
    expect(
      findOverlappingSlots([
        { dayOfWeek: 1, slots: [{ open: '20:00', close: '02:00' }] },
        { dayOfWeek: 2, slots: [{ open: '01:00', close: '05:00' }] },
      ]),
    ).not.toBeNull();
    expect(
      findOverlappingSlots([
        { dayOfWeek: 6, slots: [{ open: '20:00', close: '02:00' }] },
        { dayOfWeek: 0, slots: [{ open: '01:00', close: '05:00' }] },
      ]),
    ).not.toBeNull();
  });
});
