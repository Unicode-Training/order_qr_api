import type { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import type {
  PaymentMethodsQuery,
  RecentOrdersQuery,
  RevenueQuery,
  SummaryQuery,
  TopItemsQuery,
} from './dashboard.schema';
import * as dashboardService from './dashboard.service';

export async function summary(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await dashboardService.getSummary(req.query as unknown as SummaryQuery));
}

export async function revenue(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await dashboardService.getRevenueSeries(req.query as unknown as RevenueQuery));
}

export async function topItems(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await dashboardService.getTopItems(req.query as unknown as TopItemsQuery));
}

export async function recentOrders(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await dashboardService.getRecentOrders(req.query as unknown as RecentOrdersQuery),
  );
}

export async function paymentMethods(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await dashboardService.getPaymentMethods(req.query as unknown as PaymentMethodsQuery),
  );
}
