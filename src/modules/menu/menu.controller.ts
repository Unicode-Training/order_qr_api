import type { Request, Response } from 'express';
import { sendCreated, sendSuccess } from '../../utils/response';
import * as categoryService from './category.service';
import type {
  CreateCategoryInput,
  CreateMenuItemInput,
  ListCategoriesQuery,
  ListMenuItemsQuery,
  PublicMenuQuery,
  ReorderInput,
  UpdateCategoryInput,
  UpdateMenuItemInput,
} from './menu.schema';
import * as menuItemService from './menuItem.service';
import * as publicMenuService from './publicMenu.service';

type IdParams = { id: string };

// ---------------------------------------------------------------- Categories

export async function listCategories(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await categoryService.listCategories(req.query as unknown as ListCategoriesQuery),
  );
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  sendCreated(res, await categoryService.createCategory(req.body as CreateCategoryInput));
}

export async function getCategory(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await categoryService.getCategory(req.params.id));
}

export async function updateCategory(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(
    res,
    await categoryService.updateCategory(req.params.id, req.body as UpdateCategoryInput),
  );
}

export async function deleteCategory(req: Request<IdParams>, res: Response): Promise<void> {
  await categoryService.deleteCategory(req.params.id);
  sendSuccess(res, { id: req.params.id, deleted: true });
}

export async function reorderCategories(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await categoryService.reorderCategories(req.body as ReorderInput));
}

// ---------------------------------------------------------------- Menu items

export async function listMenuItems(req: Request, res: Response): Promise<void> {
  const { items, meta } = await menuItemService.listMenuItems(
    req.query as unknown as ListMenuItemsQuery,
  );
  sendSuccess(res, items, { meta });
}

export async function getMenuStats(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await menuItemService.getMenuStats());
}

export async function createMenuItem(req: Request, res: Response): Promise<void> {
  sendCreated(res, await menuItemService.createMenuItem(req.body as CreateMenuItemInput));
}

export async function getMenuItem(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await menuItemService.getMenuItem(req.params.id));
}

export async function updateMenuItem(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(
    res,
    await menuItemService.updateMenuItem(req.params.id, req.body as UpdateMenuItemInput),
  );
}

export async function setAvailability(req: Request<IdParams>, res: Response): Promise<void> {
  const { isAvailable } = req.body as { isAvailable: boolean };
  sendSuccess(res, await menuItemService.setAvailability(req.params.id, isAvailable));
}

export async function deleteMenuItem(req: Request<IdParams>, res: Response): Promise<void> {
  await menuItemService.deleteMenuItem(req.params.id);
  sendSuccess(res, { id: req.params.id, deleted: true });
}

export async function reorderMenuItems(req: Request, res: Response): Promise<void> {
  await menuItemService.reorderMenuItems(req.body as ReorderInput);
  sendSuccess(res, { updated: (req.body as ReorderInput).items.length });
}

// ---------------------------------------------------------------- Public

export async function getPublicMenu(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await publicMenuService.getPublicMenu(req.query as unknown as PublicMenuQuery));
}

export async function getPublicMenuItem(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await publicMenuService.getPublicMenuItem(req.params.id));
}
