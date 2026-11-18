import JSZip from 'jszip';
import { Types, type QueryFilter } from 'mongoose';
import { AppError } from '../../utils/AppError';
import {
  buildPaginationMeta,
  getPaginationOptions,
  type PaginationMeta,
} from '../../utils/pagination';
import { Area } from '../areas/area.model';
import { assertAreaExists } from '../areas/area.service';
import { getPublicRestaurant, type PublicRestaurant } from '../settings/settings.service';
import { buildTableQrUrl, QR_CONTENT_TYPES, renderQr, renderQrPng, type QrFormat } from './qr';
import { generateQrToken, Table, type ITable, type TableStatus } from './table.model';
import type {
  CreateTableInput,
  ListTablesQuery,
  QrExportQuery,
  UpdateTableInput,
} from './table.schema';

const SORT_FIELDS = ['code', 'name', 'capacity', 'status', 'createdAt', 'updatedAt'] as const;
/** Giới hạn số bàn trong một lần xuất QR. */
export const MAX_EXPORT_TABLES = 500;

type LeanTable = ITable & { _id: Types.ObjectId };

export interface TableAreaRef {
  id: string;
  name: string;
}

export interface TableDto {
  id: string;
  code: string;
  name: string;
  areaId: string | null;
  area: TableAreaRef | null;
  capacity: number;
  isActive: boolean;
  status: TableStatus;
  qrToken: string;
  /** Nội dung mã QR: `${CLIENT_URL}/t/${qrToken}`. */
  qrUrl: string;
  qrTokenUpdatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TableStats {
  /** Tổng số bàn đang hoạt động (isActive = true). */
  total: number;
  /** Đang phục vụ (occupied). */
  occupied: number;
  /** Trống (available). */
  available: number;
  /** Chờ thanh toán (needs_payment). */
  needsPayment: number;
  reserved: number;
  /** Số bàn đã tắt (không tính vào các số trên). */
  inactive: number;
}

export interface ResolvedTable {
  table: { id: string; code: string; name: string; area: TableAreaRef | null };
  restaurant: PublicRestaurant;
}

async function loadAreaMap(tables: readonly LeanTable[]): Promise<Map<string, TableAreaRef>> {
  const ids = [...new Set(tables.map((t) => t.areaId?.toString()).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const areas = await Area.find({ _id: { $in: ids } }, { name: 1 }).lean();
  return new Map(areas.map((a) => [a._id.toString(), { id: a._id.toString(), name: a.name }]));
}

function toTableDto(table: LeanTable, areas: Map<string, TableAreaRef>): TableDto {
  const areaId = table.areaId ? table.areaId.toString() : null;
  return {
    id: table._id.toString(),
    code: table.code,
    name: table.name,
    areaId,
    area: areaId ? (areas.get(areaId) ?? null) : null,
    capacity: table.capacity,
    isActive: table.isActive,
    status: table.status,
    qrToken: table.qrToken,
    qrUrl: buildTableQrUrl(table.qrToken),
    qrTokenUpdatedAt: table.qrTokenUpdatedAt,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  };
}

async function toTableDtos(tables: LeanTable[]): Promise<TableDto[]> {
  const areas = await loadAreaMap(tables);
  return tables.map((t) => toTableDto(t, areas));
}

async function toSingleDto(table: LeanTable): Promise<TableDto> {
  return (await toTableDtos([table]))[0]!;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findTableOrThrow(id: string) {
  const table = await Table.findById(id);
  if (!table) throw AppError.notFound('Không tìm thấy bàn');
  return table;
}

async function assertCodeAvailable(code: string, excludeId?: string): Promise<void> {
  const existing = await Table.exists({ code, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
  if (existing) throw new AppError(409, 'TABLE_CODE_EXISTS', 'Mã bàn đã tồn tại', { code });
}

export async function listTables(
  query: ListTablesQuery,
): Promise<{ items: TableDto[]; meta: PaginationMeta }> {
  const { page, limit, skip, sort } = getPaginationOptions(query, {
    allowedSortFields: SORT_FIELDS,
    defaultSort: { code: 1 },
  });

  const filter: QueryFilter<ITable> = {};
  if (query.areaId === 'none') filter.areaId = null;
  else if (query.areaId) filter.areaId = query.areaId;
  if (query.status) filter.status = query.status;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ code: pattern }, { name: pattern }];
  }

  const [tables, total] = await Promise.all([
    Table.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Table.countDocuments(filter),
  ]);
  return { items: await toTableDtos(tables), meta: buildPaginationMeta(total, page, limit) };
}

/** Thống kê đầu màn hình quản lý bàn. Có thể lọc theo khu vực. */
export async function getTableStats(areaId?: string): Promise<TableStats> {
  // aggregate() không tự cast string → ObjectId
  const match = areaId ? { areaId: new Types.ObjectId(areaId) } : {};
  const [byStatus, inactive] = await Promise.all([
    Table.aggregate<{ _id: TableStatus; count: number }>([
      { $match: { ...match, isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Table.countDocuments({ ...match, isActive: false }),
  ]);
  const counts = Object.fromEntries(byStatus.map((row) => [row._id, row.count])) as Partial<
    Record<TableStatus, number>
  >;
  const stats: TableStats = {
    total: byStatus.reduce((sum, row) => sum + row.count, 0),
    occupied: counts.occupied ?? 0,
    available: counts.available ?? 0,
    needsPayment: counts.needs_payment ?? 0,
    reserved: counts.reserved ?? 0,
    inactive,
  };
  return stats;
}

export async function getTable(id: string): Promise<TableDto> {
  return toSingleDto((await findTableOrThrow(id)).toObject());
}

export async function createTable(input: CreateTableInput): Promise<TableDto> {
  await assertCodeAvailable(input.code);
  if (input.areaId) await assertAreaExists(input.areaId);
  const table = await Table.create({
    code: input.code,
    name: input.name ?? `Bàn ${input.code}`,
    areaId: input.areaId,
    capacity: input.capacity,
    isActive: input.isActive,
  });
  return toSingleDto(table.toObject());
}

export async function updateTable(id: string, input: UpdateTableInput): Promise<TableDto> {
  const table = await findTableOrThrow(id);
  if (input.code !== undefined && input.code !== table.code) {
    await assertCodeAvailable(input.code, id);
    table.code = input.code;
  }
  if (input.areaId !== undefined) {
    if (input.areaId) await assertAreaExists(input.areaId);
    table.set('areaId', input.areaId);
  }
  if (input.name !== undefined) table.name = input.name;
  if (input.capacity !== undefined) table.capacity = input.capacity;
  if (input.isActive !== undefined) table.isActive = input.isActive;
  await table.save();
  return toSingleDto(table.toObject());
}

/** Xoá cứng bàn. Không cho xoá khi bàn đang phục vụ/chờ thanh toán (409 TABLE_IN_USE). */
export async function deleteTable(id: string): Promise<TableDto> {
  const table = await findTableOrThrow(id);
  if (table.status === 'occupied' || table.status === 'needs_payment') {
    throw new AppError(409, 'TABLE_IN_USE', 'Bàn đang được phục vụ, không thể xoá', {
      status: table.status,
    });
  }
  const dto = await toSingleDto(table.toObject());
  await table.deleteOne();
  return dto;
}

/** Sinh qrToken mới → mọi mã QR đã in trước đó lập tức vô hiệu. */
export async function regenerateQrToken(id: string): Promise<TableDto> {
  const table = await findTableOrThrow(id);
  table.qrToken = generateQrToken();
  table.qrTokenUpdatedAt = new Date();
  await table.save();
  return toSingleDto(table.toObject());
}

/**
 * Cập nhật trạng thái bàn — dành cho module phiên bàn (mở phiên → occupied,
 * yêu cầu thanh toán → needs_payment, đóng phiên → available).
 */
export async function setTableStatus(id: string, status: TableStatus): Promise<TableDto> {
  const table = await Table.findByIdAndUpdate(
    id,
    { $set: { status } },
    { returnDocument: 'after', lean: true },
  );
  if (!table) throw AppError.notFound('Không tìm thấy bàn');
  return toSingleDto(table);
}

export interface QrImage {
  body: Buffer;
  contentType: string;
  filename: string;
}

export async function getTableQrImage(
  id: string,
  format: QrFormat,
  size: number,
): Promise<QrImage> {
  const table = await findTableOrThrow(id);
  return {
    body: await renderQr(buildTableQrUrl(table.qrToken), format, size),
    contentType: QR_CONTENT_TYPES[format],
    filename: `qr-${table.code}.${format}`,
  };
}

/**
 * Xuất QR nhiều bàn: file ZIP, mỗi bàn một ảnh PNG tên `<code>.png`.
 * Lọc theo `ids` hoặc `areaId`; mặc định chỉ bàn đang hoạt động.
 */
export async function exportTableQrZip(query: QrExportQuery): Promise<QrImage> {
  const filter: QueryFilter<ITable> = {};
  if (query.ids && query.ids.length > 0) filter._id = { $in: query.ids };
  if (query.areaId) filter.areaId = query.areaId;
  if (!query.includeInactive) filter.isActive = true;

  const tables = await Table.find(filter, { code: 1, qrToken: 1 })
    .sort({ code: 1 })
    .limit(MAX_EXPORT_TABLES + 1)
    .lean();
  if (tables.length === 0) throw AppError.notFound('Không có bàn nào để xuất mã QR');
  if (tables.length > MAX_EXPORT_TABLES) {
    throw AppError.badRequest(
      `Chỉ xuất tối đa ${MAX_EXPORT_TABLES} bàn mỗi lần, hãy lọc theo khu vực hoặc ids`,
    );
  }

  const zip = new JSZip();
  const images = await Promise.all(
    tables.map(async (t) => ({
      name: `${t.code}.png`,
      data: await renderQrPng(buildTableQrUrl(t.qrToken), query.size),
    })),
  );
  for (const image of images) zip.file(image.name, image.data);

  return {
    body: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    contentType: 'application/zip',
    filename: `table-qr-codes-${new Date().toISOString().slice(0, 10)}.zip`,
  };
}

/**
 * Khách quét QR → xác định bàn. 404 nếu token sai, đã bị thay (regenerate) hoặc bàn đã tắt.
 */
export async function resolveQrToken(qrToken: string): Promise<ResolvedTable> {
  const table = /^[A-Za-z0-9_-]{16,100}$/.test(qrToken)
    ? await Table.findOne({ qrToken, isActive: true }).lean()
    : null;
  if (!table)
    throw new AppError(404, 'TABLE_NOT_FOUND', 'Mã QR không hợp lệ hoặc bàn không còn sử dụng');

  const [dto, restaurant] = await Promise.all([toSingleDto(table), getPublicRestaurant()]);
  return {
    table: { id: dto.id, code: dto.code, name: dto.name, area: dto.area },
    restaurant,
  };
}
