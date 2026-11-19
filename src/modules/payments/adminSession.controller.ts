import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import type { ListAdminSessionsQuery, UpdateAdminSessionInput } from './adminSession.schema';
import * as adminSessionService from './adminSession.service';

type IdReq = Request<{ id: string }>;

export async function listSessions(req: Request, res: Response): Promise<void> {
  const { items, meta } = await adminSessionService.listSessions(
    req.query as unknown as ListAdminSessionsQuery,
  );
  sendSuccess(res, items, { meta });
}

export async function getSession(req: IdReq, res: Response): Promise<void> {
  sendSuccess(res, await adminSessionService.getSession(req.params.id));
}

export async function updateSession(req: IdReq, res: Response): Promise<void> {
  sendSuccess(
    res,
    await adminSessionService.updateSession(req.params.id, req.body as UpdateAdminSessionInput),
  );
}
