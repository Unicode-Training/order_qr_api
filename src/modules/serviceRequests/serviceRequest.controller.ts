import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/authenticate';
import { sendCreated, sendSuccess } from '../../utils/response';
import { getGuestSession } from '../sessions/session.middleware';
import type {
  CreateServiceRequestInput,
  ListAdminServiceRequestsQuery,
  ListGuestServiceRequestsQuery,
  UpdateServiceRequestInput,
} from './serviceRequest.schema';
import * as serviceRequestService from './serviceRequest.service';

export async function createByGuest(req: Request, res: Response): Promise<void> {
  sendCreated(
    res,
    await serviceRequestService.createServiceRequest(
      getGuestSession(req),
      req.body as CreateServiceRequestInput,
    ),
  );
}

export async function listByGuest(req: Request, res: Response): Promise<void> {
  const { items, serverTime } = await serviceRequestService.listSessionServiceRequests(
    getGuestSession(req),
    req.query as unknown as ListGuestServiceRequestsQuery,
  );
  sendSuccess(res, items, { meta: { serverTime } });
}

export async function listByStaff(req: Request, res: Response): Promise<void> {
  const { items, meta } = await serviceRequestService.listServiceRequests(
    req.query as unknown as ListAdminServiceRequestsQuery,
  );
  sendSuccess(res, items, { meta });
}

export async function updateByStaff(req: Request<{ id: string }>, res: Response): Promise<void> {
  sendSuccess(
    res,
    await serviceRequestService.updateServiceRequest(
      req.params.id,
      req.body as UpdateServiceRequestInput,
      getAuthUser(req).id,
    ),
  );
}
