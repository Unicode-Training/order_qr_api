import type { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { Table } from '../tables/table.model';
import { Area, toAreaDto, type AreaDto } from './area.model';
import type { CreateAreaInput, UpdateAreaInput } from './area.schema';

export interface AreaWithCount extends AreaDto {
  /** Số bàn thuộc khu vực (kể cả bàn đã tắt). */
  tableCount: number;
}

async function countTablesByArea(): Promise<Map<string, number>> {
  const rows = await Table.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $group: { _id: '$areaId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

/** Danh sách khu vực theo sortOrder, name (không phân trang — số khu vực nhỏ). */
export async function listAreas(): Promise<AreaWithCount[]> {
  const [areas, counts] = await Promise.all([
    Area.find().sort({ sortOrder: 1, name: 1 }).lean(),
    countTablesByArea(),
  ]);
  return areas.map((area) => ({
    ...toAreaDto(area),
    tableCount: counts.get(area._id.toString()) ?? 0,
  }));
}

async function findAreaOrThrow(id: string) {
  const area = await Area.findById(id);
  if (!area) throw AppError.notFound('Không tìm thấy khu vực');
  return area;
}

/** Ném 400 nếu `areaId` không tồn tại (dùng khi tạo/sửa bàn). */
export async function assertAreaExists(areaId: string): Promise<void> {
  if (!(await Area.exists({ _id: areaId }))) {
    throw new AppError(400, 'AREA_NOT_FOUND', 'Khu vực không tồn tại', { areaId });
  }
}

export async function getArea(id: string): Promise<AreaWithCount> {
  const area = await findAreaOrThrow(id);
  return { ...toAreaDto(area), tableCount: await Table.countDocuments({ areaId: area._id }) };
}

export async function createArea(input: CreateAreaInput): Promise<AreaWithCount> {
  const area = await Area.create(input);
  return { ...toAreaDto(area), tableCount: 0 };
}

export async function updateArea(id: string, input: UpdateAreaInput): Promise<AreaWithCount> {
  const area = await findAreaOrThrow(id);
  if (input.name !== undefined) area.name = input.name;
  if (input.sortOrder !== undefined) area.sortOrder = input.sortOrder;
  await area.save();
  return { ...toAreaDto(area), tableCount: await Table.countDocuments({ areaId: area._id }) };
}

/** Xoá cứng khu vực — chỉ khi không còn bàn nào thuộc khu vực (409 AREA_HAS_TABLES). */
export async function deleteArea(id: string): Promise<AreaDto> {
  const area = await findAreaOrThrow(id);
  const tableCount = await Table.countDocuments({ areaId: area._id });
  if (tableCount > 0) {
    throw new AppError(
      409,
      'AREA_HAS_TABLES',
      'Khu vực vẫn còn bàn, hãy chuyển hoặc xoá các bàn trước',
      { tableCount },
    );
  }
  await area.deleteOne();
  return toAreaDto(area);
}
