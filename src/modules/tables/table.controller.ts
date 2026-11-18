import type { Request, Response } from 'express';
import { sendCreated, sendSuccess } from '../../utils/response';
import type {
  CreateTableInput,
  ListTablesQuery,
  QrExportQuery,
  QrImageQuery,
  UpdateTableInput,
} from './table.schema';
import * as tableService from './table.service';

type IdParams = { id: string };

function sendFile(res: Response, file: tableService.QrImage, attachment: boolean): void {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader(
    'Content-Disposition',
    `${attachment ? 'attachment' : 'inline'}; filename="${file.filename}"`,
  );
  // Ảnh QR thay đổi khi regenerate → không cache
  res.setHeader('Cache-Control', 'no-store');
  res.send(file.body);
}

export async function list(req: Request, res: Response): Promise<void> {
  const { items, meta } = await tableService.listTables(req.query as unknown as ListTablesQuery);
  sendSuccess(res, items, { meta });
}

export async function stats(req: Request, res: Response): Promise<void> {
  const { areaId } = req.query as { areaId?: string };
  sendSuccess(res, await tableService.getTableStats(areaId));
}

export async function create(req: Request, res: Response): Promise<void> {
  sendCreated(res, await tableService.createTable(req.body as CreateTableInput));
}

export async function getById(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await tableService.getTable(req.params.id));
}

export async function update(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await tableService.updateTable(req.params.id, req.body as UpdateTableInput));
}

export async function remove(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await tableService.deleteTable(req.params.id));
}

export async function regenerateQr(req: Request<IdParams>, res: Response): Promise<void> {
  sendSuccess(res, await tableService.regenerateQrToken(req.params.id));
}

export async function qrImage(req: Request<IdParams>, res: Response): Promise<void> {
  const query = req.query as unknown as QrImageQuery;
  const file = await tableService.getTableQrImage(req.params.id, query.format, query.size);
  sendFile(res, file, query.download === true);
}

export async function exportQr(req: Request, res: Response): Promise<void> {
  const file = await tableService.exportTableQrZip(req.query as unknown as QrExportQuery);
  sendFile(res, file, true);
}

export async function resolvePublic(
  req: Request<{ qrToken: string }>,
  res: Response,
): Promise<void> {
  sendSuccess(res, await tableService.resolveQrToken(req.params.qrToken));
}
