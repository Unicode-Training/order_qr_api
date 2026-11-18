import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import * as orderService from '../orders/order.service';
import type { ListSessionOrdersQuery } from '../orders/order.schema';
import { getGuestSession } from './session.middleware';
import type { OpenSessionInput, UpdateSessionInput } from './session.schema';
import * as sessionService from './session.service';

export async function openSession(req: Request, res: Response): Promise<void> {
  const result = await sessionService.openSession(req.body as OpenSessionInput);
  sendSuccess(res, result, { statusCode: result.isNew ? 201 : 200 });
}

export async function getCurrent(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await sessionService.getCurrentSession(getGuestSession(req)));
}

export async function updateCurrent(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await sessionService.updateCurrentSession(getGuestSession(req), req.body as UpdateSessionInput),
  );
}

export async function listOrders(req: Request, res: Response): Promise<void> {
  const { items, serverTime } = await orderService.listSessionOrders(
    getGuestSession(req),
    req.query as unknown as ListSessionOrdersQuery,
  );
  sendSuccess(res, items, { meta: { serverTime, count: items.length } });
}
