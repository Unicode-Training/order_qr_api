import type { Request, Response } from 'express';
import { getAuthUser } from '../../middlewares/authenticate';
import { sendSuccess } from '../../utils/response';
import type { ChangePasswordInput, LoginInput } from './auth.schema';
import * as authService from './auth.service';

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput);
  sendSuccess(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken: string };
  sendSuccess(res, await authService.refresh(refreshToken));
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as { refreshToken: string };
  await authService.logout(refreshToken);
  sendSuccess(res, { message: 'Đã đăng xuất' });
}

export async function me(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await authService.getProfile(getAuthUser(req).id));
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const tokens = await authService.changePassword(
    getAuthUser(req).id,
    req.body as ChangePasswordInput,
  );
  sendSuccess(res, tokens);
}
