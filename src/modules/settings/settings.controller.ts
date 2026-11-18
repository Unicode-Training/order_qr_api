import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import type { PatchSettingsInput, RestaurantSettingsData } from './settings.schema';
import * as settingsService from './settings.service';

export async function getPublic(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await settingsService.getPublicRestaurant());
}

export async function get(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await settingsService.getSettings());
}

export async function replace(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await settingsService.replaceSettings(req.body as RestaurantSettingsData));
}

export async function patch(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await settingsService.patchSettings(req.body as PatchSettingsInput));
}
