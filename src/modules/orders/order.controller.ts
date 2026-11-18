import type { Request, Response } from 'express';
import { sendCreated, sendSuccess } from '../../utils/response';
import { getGuestSession } from '../sessions/session.middleware';
import type { CancelOrderInput, CreateOrderInput, QuoteOrderInput } from './order.schema';
import * as orderService from './order.service';

export async function quote(req: Request, res: Response): Promise<void> {
  getGuestSession(req);
  sendSuccess(res, await orderService.quoteOrder(req.body as QuoteOrderInput));
}

export async function create(req: Request, res: Response): Promise<void> {
  sendCreated(
    res,
    await orderService.createOrder(getGuestSession(req), req.body as CreateOrderInput),
  );
}

export async function cancel(req: Request<{ id: string }>, res: Response): Promise<void> {
  sendSuccess(
    res,
    await orderService.cancelOrderByGuest(
      getGuestSession(req),
      req.params.id,
      req.body as CancelOrderInput,
    ),
  );
}
