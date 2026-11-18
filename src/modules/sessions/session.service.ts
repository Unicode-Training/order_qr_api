import type { Types } from 'mongoose';
import { AppError } from '../../utils/AppError';
import { Area } from '../areas/area.model';
import { getSessionBill, type GuestSessionRef, type SessionBill } from '../orders/order.service';
import { Table } from '../tables/table.model';
import type { OpenSessionInput, UpdateSessionInput } from './session.schema';
import { TableSession, type ITableSession, type SessionStatus } from './tableSession.model';

type LeanSession = ITableSession & { _id: Types.ObjectId };

export interface SessionDto {
  id: string;
  status: SessionStatus;
  guestCount: number | null;
  customerName: string | null;
  note: string | null;
  openedAt: Date;
  closedAt: Date | null;
}

export interface SessionTableDto {
  id: string;
  code: string;
  name: string;
  area: { id: string; name: string } | null;
}

export interface OpenSessionResult {
  /** Token để gọi các API khách (header X-Session-Token) — client lưu vào localStorage. */
  sessionToken: string;
  /** true nếu vừa mở phiên mới, false nếu tham gia phiên đang mở của bàn. */
  isNew: boolean;
  session: SessionDto;
  table: SessionTableDto;
}

export interface CurrentSessionResult {
  session: SessionDto;
  table: SessionTableDto;
  /** Tạm tính của cả phiên (không tính đơn đã huỷ). */
  bill: SessionBill;
}

function toSessionDto(session: LeanSession): SessionDto {
  return {
    id: session._id.toString(),
    status: session.status,
    guestCount: session.guestCount ?? null,
    customerName: session.customerName ?? null,
    note: session.note ?? null,
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? null,
  };
}

async function loadTableDto(tableId: Types.ObjectId | string): Promise<SessionTableDto> {
  const table = await Table.findById(tableId).select('code name areaId').lean();
  if (!table) throw AppError.notFound('Không tìm thấy bàn');
  const area = table.areaId ? await Area.findById(table.areaId).select('name').lean() : null;
  return {
    id: table._id.toString(),
    code: table.code,
    name: table.name,
    area: area ? { id: area._id.toString(), name: area.name } : null,
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/**
 * Khách quét QR: bàn đang có phiên chưa đóng → trả lại phiên đó (cả bàn dùng chung);
 * chưa có → mở phiên mới và đánh dấu bàn occupied.
 * An toàn khi nhiều khách quét cùng lúc (unique index một phần trên tableId).
 */
export async function openSession(input: OpenSessionInput): Promise<OpenSessionResult> {
  const table = /^[A-Za-z0-9_-]{16,100}$/.test(input.qrToken)
    ? await Table.findOne({ qrToken: input.qrToken, isActive: true }).select('_id').lean()
    : null;
  if (!table) {
    throw new AppError(404, 'TABLE_NOT_FOUND', 'Mã QR không hợp lệ hoặc bàn không còn sử dụng');
  }

  let session = await joinActiveSession(table._id, input);
  let isNew = false;
  if (!session) {
    try {
      const created = await TableSession.create({
        tableId: table._id,
        guestCount: input.guestCount ?? null,
        customerName: input.customerName,
        note: input.note,
      });
      session = created.toObject();
      isNew = true;
    } catch (err) {
      // Khách khác của cùng bàn vừa mở phiên trước → dùng chung phiên đó.
      if (!isDuplicateKeyError(err)) throw err;
      session = await joinActiveSession(table._id, input);
      if (!session) throw err;
    }
  }

  if (isNew) {
    await Table.updateOne(
      { _id: table._id, status: { $in: ['available', 'reserved'] } },
      { $set: { status: 'occupied' } },
    );
  }

  return {
    sessionToken: session.sessionToken,
    isNew,
    session: toSessionDto(session),
    table: await loadTableDto(table._id),
  };
}

/** Tìm phiên chưa đóng của bàn; bổ sung số khách/tên/ghi chú nếu khách mới gửi kèm. */
async function joinActiveSession(
  tableId: Types.ObjectId,
  input: OpenSessionInput,
): Promise<LeanSession | null> {
  const session = await TableSession.findOne({ tableId, isActive: true }).lean<LeanSession>();
  if (!session) return null;

  const update: Partial<ITableSession> = {};
  if (input.guestCount && input.guestCount > (session.guestCount ?? 0)) {
    update.guestCount = input.guestCount;
  }
  if (input.customerName && !session.customerName) update.customerName = input.customerName;
  if (input.note && !session.note) update.note = input.note;
  if (Object.keys(update).length === 0) return session;

  const updated = await TableSession.findByIdAndUpdate(
    session._id,
    { $set: update },
    { returnDocument: 'after', lean: true },
  );
  return (updated as LeanSession | null) ?? session;
}

/** Thông tin phiên hiện tại + bàn + tổng tạm tính cả phiên. */
export async function getCurrentSession(ref: GuestSessionRef): Promise<CurrentSessionResult> {
  const session = await TableSession.findById(ref.id).lean<LeanSession>();
  if (!session) throw new AppError(401, 'INVALID_SESSION', 'Phiên bàn không hợp lệ');
  const [table, bill] = await Promise.all([loadTableDto(session.tableId), getSessionBill(ref.id)]);
  return { session: toSessionDto(session), table, bill };
}

/** Khách cập nhật số khách / tên / ghi chú của phiên (màn "Chào mừng"). */
export async function updateCurrentSession(
  ref: GuestSessionRef,
  input: UpdateSessionInput,
): Promise<SessionDto> {
  const update = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  const session = await TableSession.findOneAndUpdate(
    { _id: ref.id, isActive: true },
    { $set: update },
    { returnDocument: 'after', lean: true, runValidators: true },
  );
  if (!session) throw new AppError(401, 'SESSION_CLOSED', 'Phiên bàn đã kết thúc');
  return toSessionDto(session as LeanSession);
}
