import type { Request, Response } from 'express';
import { sendCreated, sendSuccess } from '../../utils/response';
import type { CreateAreaInput, UpdateAreaInput } from './area.schema';
import * as areaService from './area.service';

type IdParams = { id: string };

export async function list(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await areaService.listAreas());
}

export async function create(req: Request, res: Response): Promise<void> {
  sendCreated(res, await areaService.createArea(req.body as CreateAreaInput));
}

export async function getById(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await areaService.getArea(req.params.id));
}

export async function update(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await areaService.updateArea(req.params.id, req.body as UpdateAreaInput));
}

export async function remove(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await areaService.deleteArea(req.params.id));
}
