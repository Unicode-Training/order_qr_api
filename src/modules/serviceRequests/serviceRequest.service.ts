import { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import {
  buildPaginationMeta,
  getPaginationOptions,
  type PaginationMeta,
} from '../../utils/pagination';
import { Area } from '../areas/area.model';
import type { GuestSessionRef } from '../orders/order.service';
import { Table } from '../tables/table.model';
import { User } from '../users/user.model';
import {
  OPEN_SERVICE_REQUEST_STATUSES,
  ServiceRequest,
  type IServiceRequest,
  type ServiceRequestStatus,
  type ServiceRequestType,
} from './serviceRequest.model';
import type {
  CreateServiceRequestInput,
  ListAdminServiceRequestsQuery,
  ListGuestServiceRequestsQuery,
  UpdateServiceRequestInput,
} from './serviceRequest.schema';

type LeanServiceRequest = IServiceRequest & { _id: Types.ObjectId };

export interface GuestServiceRequestDto {
  id: string;
  type: ServiceRequestType;
  note: string | null;
  status: ServiceRequestStatus;
  acknowledgedAt: Date | null;
  doneAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminServiceRequestDto extends GuestServiceRequestDto {
  sessionId: string;
  tableId: string;
  table: {
    id: string;
    code: string;
    name: string;
    area: { id: string; name: string } | null;
  } | null;
  handledBy: { id: string; fullName: string } | null;
}

function toGuestDto(request: LeanServiceRequest): GuestServiceRequestDto {
  return {
    id: request._id.toString(),
    type: request.type,
    note: request.note ?? null,
    status: request.status,
    acknowledgedAt: request.acknowledgedAt ?? null,
    doneAt: request.doneAt ?? null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

async function toAdminDtos(requests: LeanServiceRequest[]): Promise<AdminServiceRequestDto[]> {
  if (requests.length === 0) return [];
  const tableIds = [...new Set(requests.map((r) => r.tableId.toString()))];
  const userIds = [
    ...new Set(requests.flatMap((r) => (r.handledBy ? [r.handledBy.toString()] : []))),
  ];
  const [tables, users] = await Promise.all([
    Table.find({ _id: { $in: tableIds } })
      .select('code name areaId')
      .lean(),
    userIds.length > 0
      ? User.find({ _id: { $in: userIds } })
          .select('fullName')
          .lean()
      : Promise.resolve([]),
  ]);
  const areaIds = [...new Set(tables.flatMap((t) => (t.areaId ? [t.areaId.toString()] : [])))];
  const areas =
    areaIds.length > 0
      ? await Area.find({ _id: { $in: areaIds } })
          .select('name')
          .lean()
      : [];
  const areaById = new Map(
    areas.map((a) => [a._id.toString(), { id: a._id.toString(), name: a.name }]),
  );
  const tableById = new Map(
    tables.map((t) => [
      t._id.toString(),
      {
        id: t._id.toString(),
        code: t.code,
        name: t.name,
        area: t.areaId ? (areaById.get(t.areaId.toString()) ?? null) : null,
      },
    ]),
  );
  const userById = new Map(
    users.map((u) => [u._id.toString(), { id: u._id.toString(), fullName: u.fullName }]),
  );

  return requests.map((request) => ({
    ...toGuestDto(request),
    sessionId: request.sessionId.toString(),
    tableId: request.tableId.toString(),
    table: tableById.get(request.tableId.toString()) ?? null,
    handledBy: request.handledBy
      ? (userById.get(request.handledBy.toString()) ?? {
          id: request.handledBy.toString(),
          fullName: '',
        })
      : null,
  }));
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

// ------------------------------------------------------------------ Khách

/**
 * Khách gửi yêu cầu nhanh. Chống spam: đã có yêu cầu CÙNG LOẠI đang pending trong phiên
 * → 409 SERVICE_REQUEST_DUPLICATE (details = yêu cầu đang chờ). Đảm bảo bằng unique index một phần.
 */
export async function createServiceRequest(
  session: GuestSessionRef,
  input: CreateServiceRequestInput,
): Promise<GuestServiceRequestDto> {
  try {
    const created = await ServiceRequest.create({
      sessionId: session.id,
      tableId: session.tableId,
      type: input.type,
      note: input.note,
    });
    return toGuestDto(created.toObject());
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const existing = await ServiceRequest.findOne({
      sessionId: session.id,
      type: input.type,
      status: 'pending',
    }).lean<LeanServiceRequest>();
    throw new AppError(
      409,
      'SERVICE_REQUEST_DUPLICATE',
      'Yêu cầu này đã được gửi, nhân viên sẽ tới ngay',
      existing ? toGuestDto(existing) : undefined,
    );
  }
}

export interface GuestServiceRequestsResult {
  items: GuestServiceRequestDto[];
  serverTime: Date;
}

/** Yêu cầu của phiên hiện tại (mới nhất trước); `updatedSince` để polling. */
export async function listSessionServiceRequests(
  session: GuestSessionRef,
  query: ListGuestServiceRequestsQuery,
): Promise<GuestServiceRequestsResult> {
  const serverTime = new Date();
  const filter: Record<string, unknown> = { sessionId: session.id };
  if (query.updatedSince) filter.updatedAt = { $gt: query.updatedSince };
  const requests = await ServiceRequest.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(100)
    .lean<LeanServiceRequest[]>();
  return { items: requests.map(toGuestDto), serverTime };
}

// ------------------------------------------------------------------ Nhân viên

export const SERVICE_REQUEST_SORT_FIELDS = ['createdAt', 'updatedAt', 'status', 'type'];

export async function listServiceRequests(query: ListAdminServiceRequestsQuery): Promise<{
  items: AdminServiceRequestDto[];
  meta: PaginationMeta & { serverTime: Date };
}> {
  const serverTime = new Date();
  const { page, limit, skip, sort } = getPaginationOptions(query, {
    allowedSortFields: SERVICE_REQUEST_SORT_FIELDS,
    defaultSort: { createdAt: -1 },
  });

  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = { $in: query.status };
  if (query.type) filter.type = { $in: query.type };
  if (query.updatedSince) filter.updatedAt = { $gt: query.updatedSince };
  if (query.areaId) {
    const ids = (await Table.find({ areaId: query.areaId }).select('_id').lean()).map((t) =>
      t._id.toString(),
    );
    const allowed = query.tableId ? ids.filter((id) => id === query.tableId!.toLowerCase()) : ids;
    filter.tableId = { $in: allowed.map((id) => new Types.ObjectId(id)) };
  } else if (query.tableId) {
    filter.tableId = new Types.ObjectId(query.tableId);
  }

  const [requests, total] = await Promise.all([
    ServiceRequest.find(filter)
      .sort({ ...sort, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean<LeanServiceRequest[]>(),
    ServiceRequest.countDocuments(filter),
  ]);
  return {
    items: await toAdminDtos(requests),
    meta: { ...buildPaginationMeta(total, page, limit), serverTime },
  };
}

/** Trạng thái trước đó hợp lệ cho mỗi trạng thái đích. */
const ALLOWED_FROM: Record<'acknowledged' | 'done', ServiceRequestStatus[]> = {
  acknowledged: ['pending'],
  done: ['pending', 'acknowledged'],
};

/** Nhân viên tiếp nhận / hoàn tất yêu cầu: pending → acknowledged | done, acknowledged → done. */
export async function updateServiceRequest(
  id: string,
  input: UpdateServiceRequestInput,
  userId: string,
): Promise<AdminServiceRequestDto> {
  const now = new Date();
  const set: Record<string, unknown> = {
    status: input.status,
    handledBy: new Types.ObjectId(userId),
  };
  if (input.status === 'acknowledged') set.acknowledgedAt = now;
  if (input.status === 'done') set.doneAt = now;

  const updated = await ServiceRequest.findOneAndUpdate(
    { _id: id, status: { $in: ALLOWED_FROM[input.status] } },
    { $set: set },
    { returnDocument: 'after', lean: true },
  );
  if (!updated) {
    const existing = await ServiceRequest.findById(id).select('status').lean();
    if (!existing) throw AppError.notFound('Không tìm thấy yêu cầu');
    throw new AppError(
      409,
      'INVALID_STATUS_TRANSITION',
      `Không thể chuyển yêu cầu từ "${existing.status}" sang "${input.status}"`,
      { from: existing.status, to: input.status },
    );
  }
  const [dto] = await toAdminDtos([updated as LeanServiceRequest]);
  return dto!;
}

// ------------------------------------------------------------------ Dùng cho thanh toán / đóng phiên

type Id = string | Types.ObjectId;

/**
 * Khách yêu cầu thanh toán (POST /public/sessions/current/request-bill): dùng lại request_bill còn mở
 * của phiên (kể cả do khách gửi qua /public/service-requests), chưa có thì tạo mới (pending).
 * Gọi lại nhiều lần chỉ cập nhật phương thức mong muốn.
 */
export async function upsertBillRequest(
  sessionId: Id,
  tableId: Id,
  preferredMethod: string | null,
): Promise<LeanServiceRequest> {
  const findOpen = () =>
    ServiceRequest.findOneAndUpdate(
      { sessionId, type: 'request_bill', status: { $in: OPEN_SERVICE_REQUEST_STATUSES } },
      preferredMethod ? { $set: { preferredMethod } } : {},
      { sort: { createdAt: -1 }, returnDocument: 'after', lean: true },
    ) as Promise<LeanServiceRequest | null>;

  const existing = await findOpen();
  if (existing) return existing;
  try {
    const created = await ServiceRequest.create({
      sessionId,
      tableId,
      type: 'request_bill',
      preferredMethod,
    });
    return created.toObject();
  } catch (err) {
    // Request khác vừa tạo request_bill pending (unique index một phần) → dùng lại.
    if (!isDuplicateKeyError(err)) throw err;
    const raced = await findOpen();
    if (!raced) throw err;
    return raced;
  }
}

/** Đóng phiên → mọi yêu cầu còn mở của phiên chuyển `done`. Trả số yêu cầu đã cập nhật. */
export async function resolveOpenRequestsOfSession(
  sessionId: Id,
  handledBy: Id | null,
  now = new Date(),
): Promise<number> {
  const result = await ServiceRequest.updateMany(
    { sessionId, status: { $in: OPEN_SERVICE_REQUEST_STATUSES } },
    { $set: { status: 'done', doneAt: now, handledBy } },
  );
  return result.modifiedCount;
}

/** Chuyển bàn: các yêu cầu của phiên đi theo bàn mới. */
export async function moveRequestsToTable(sessionId: Id, tableId: Id): Promise<void> {
  await ServiceRequest.updateMany({ sessionId }, { $set: { tableId } });
}
