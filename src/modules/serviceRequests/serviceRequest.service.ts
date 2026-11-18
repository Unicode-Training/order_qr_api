import type { Types } from 'mongoose';
import {
  OPEN_SERVICE_REQUEST_STATUSES,
  ServiceRequest,
  type IServiceRequest,
} from './serviceRequest.model';

type Id = string | Types.ObjectId;

/**
 * Tạo (hoặc cập nhật) yêu cầu thanh toán còn mở của phiên — mỗi phiên tối đa 1 request_bill đang mở,
 * khách bấm "Yêu cầu thanh toán" nhiều lần chỉ cập nhật phương thức mong muốn.
 */
export async function upsertBillRequest(
  sessionId: Id,
  tableId: Id,
  preferredMethod: string | null,
): Promise<IServiceRequest & { _id: Types.ObjectId }> {
  const existing = await ServiceRequest.findOneAndUpdate(
    { sessionId, type: 'request_bill', status: { $in: OPEN_SERVICE_REQUEST_STATUSES } },
    preferredMethod ? { $set: { preferredMethod } } : {},
    { returnDocument: 'after', lean: true },
  );
  if (existing) return existing;
  const created = await ServiceRequest.create({
    sessionId,
    tableId,
    type: 'request_bill',
    preferredMethod,
  });
  return created.toObject();
}

/** Đóng phiên → mọi yêu cầu còn mở của phiên chuyển `done`. Trả số yêu cầu đã cập nhật. */
export async function resolveOpenRequestsOfSession(
  sessionId: Id,
  resolvedBy: Id | null,
  now = new Date(),
): Promise<number> {
  const result = await ServiceRequest.updateMany(
    { sessionId, status: { $in: OPEN_SERVICE_REQUEST_STATUSES } },
    { $set: { status: 'done', resolvedAt: now, resolvedBy } },
  );
  return result.modifiedCount;
}

/** Chuyển bàn: các yêu cầu của phiên đi theo bàn mới. */
export async function moveRequestsToTable(sessionId: Id, tableId: Id): Promise<void> {
  await ServiceRequest.updateMany({ sessionId }, { $set: { tableId } });
}
