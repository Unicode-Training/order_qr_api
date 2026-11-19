import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/authenticate';
import { sendCreated, sendSuccess } from '../../utils/response';
import { getGuestSession } from '../sessions/session.middleware';
import * as billService from './bill.service';
import type {
  CancelSessionInput,
  ListPaymentsQuery,
  MoveSessionInput,
  RecordPaymentInput,
  RequestBillInput,
  VoidPaymentInput,
} from './payment.schema';
import * as paymentService from './payment.service';

type IdReq = Request<{ id: string }>;

// Khách
export async function requestBill(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await paymentService.requestBill(getGuestSession(req), req.body as RequestBillInput),
  );
}

export async function getGuestBill(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await paymentService.getGuestBill(getGuestSession(req)));
}

// Nhân viên
export async function getTableBill(req: IdReq, res: Response): Promise<void> {
  sendSuccess(res, await billService.getBillOfTable(req.params.id));
}

export async function getSessionBill(req: IdReq, res: Response): Promise<void> {
  sendSuccess(res, await billService.getBillOfSession(req.params.id));
}

export async function recordPayment(req: IdReq, res: Response): Promise<void> {
  sendCreated(
    res,
    await paymentService.recordPayment(
      req.params.id,
      req.body as RecordPaymentInput,
      getAuthUser(req).id,
    ),
  );
}

export async function moveSession(req: IdReq, res: Response): Promise<void> {
  sendSuccess(res, await paymentService.moveSession(req.params.id, req.body as MoveSessionInput));
}

export async function cancelSession(req: IdReq, res: Response): Promise<void> {
  sendSuccess(
    res,
    await paymentService.cancelSession(
      req.params.id,
      req.body as CancelSessionInput,
      getAuthUser(req).id,
    ),
  );
}

export async function listPayments(req: Request, res: Response): Promise<void> {
  const { items, meta } = await paymentService.listPayments(
    req.query as unknown as ListPaymentsQuery,
  );
  sendSuccess(res, items, { meta });
}

export async function getPayment(req: IdReq, res: Response): Promise<void> {
  sendSuccess(res, await paymentService.getPayment(req.params.id));
}

export async function voidPayment(req: IdReq, res: Response): Promise<void> {
  sendSuccess(
    res,
    await paymentService.voidPayment(
      req.params.id,
      req.body as VoidPaymentInput,
      getAuthUser(req).id,
    ),
  );
}
