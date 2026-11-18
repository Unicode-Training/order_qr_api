import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/authenticate';
import { sendCreated, sendSuccess } from '../../utils/response';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.schema';
import * as userService from './user.service';

type IdParams = { id: string };

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await userService.listUsers(req.query as unknown as ListUsersQuery);
  sendSuccess(res, items, { meta });
}

export async function create(req: Request, res: Response): Promise<void> {
  sendCreated(res, await userService.createUser(req.body as CreateUserInput));
}

export async function getById(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await userService.getUser(req.params.id));
}

export async function update(req: Request<IdParams>, res: Response): Promise<void> {
  const user = await userService.updateUser(
    req.params.id,
    req.body as UpdateUserInput,
    getAuthUser(req).id,
  );
  sendSuccess(res, user);
}

export async function disable(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await userService.disableUser(req.params.id, getAuthUser(req).id));
}
