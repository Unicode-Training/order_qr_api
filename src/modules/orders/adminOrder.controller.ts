import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/authenticate';
import { sendSuccess } from '../../utils/response';
import type {
  ListAdminOrdersQuery,
  OrderBoardQuery,
  StaffCreateOrderInput,
  UpdateOrderItemInput,
  UpdateOrderStatusInput,
} from './adminOrder.schema';
import * as adminOrderService from './adminOrder.service';

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await adminOrderService.listOrders(
    req.query as unknown as ListAdminOrdersQuery,
  );
  sendSuccess(res, items, { meta });
}

export async function board(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await adminOrderService.getOrderBoard(req.query as unknown as OrderBoardQuery));
}

export async function getById(req: Request<{ id: string }>, res: Response): Promise<void> {
  sendSuccess(res, await adminOrderService.getOrder(req.params.id));
}

export async function updateStatus(req: Request<{ id: string }>, res: Response): Promise<void> {
  sendSuccess(
    res,
    await adminOrderService.updateOrderStatus(
      req.params.id,
      req.body as UpdateOrderStatusInput,
      getAuthUser(req).id,
    ),
  );
}

export async function updateItem(
  req: Request<{ id: string; itemId: string }>,
  res: Response,
): Promise<void> {
  sendSuccess(
    res,
    await adminOrderService.updateOrderItem(
      req.params.id,
      req.params.itemId,
      req.body as UpdateOrderItemInput,
      getAuthUser(req).id,
    ),
  );
}

export async function createForTable(req: Request<{ id: string }>, res: Response): Promise<void> {
  const { order, sessionCreated } = await adminOrderService.createOrderForTable(
    req.params.id,
    req.body as StaffCreateOrderInput,
    getAuthUser(req).id,
  );
  sendSuccess(res, order, { statusCode: 201, meta: { sessionCreated } });
}
