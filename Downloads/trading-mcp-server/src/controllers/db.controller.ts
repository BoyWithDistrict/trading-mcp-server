import { Request, Response } from 'express';
import { BaseController } from './base.controller';
import prisma from '../services/prisma';
import { getOrCreateDemoUserId } from '../services/user.service';

export class DbController extends BaseController {
  public listTrades = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();

    const { symbol, from, to, limit = '50', cursor } = req.query as Record<string, string>;
    const take = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 500);

    const where: any = { userId, deletedAt: null };
    if (symbol) where.ticker = String(symbol).toUpperCase();
    if (from) where.entryTime = { ...(where.entryTime || {}), gte: new Date(from) };
    if (to) where.entryTime = { ...(where.entryTime || {}), lte: new Date(to) };

    const query: any = {
      where,
      orderBy: { entryTime: 'asc' },
      take,
    };

    if (cursor) {
      query.cursor = { id: String(cursor) };
      query.skip = 1;
    }

    const trades = await prisma.trade.findMany(query);

    // nextCursor — последний id в выдаче
    const nextCursor = trades.length === take ? trades[trades.length - 1].id : null;

    return this.handleSuccess(res, { trades, nextCursor });
  });

  public createTrade = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();

    const {
      ticker,
      strategy,
      entryTime,
      exitTime,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      lot,
      riskPercent,
      profit,
      emotion,
      isPlanned,
      planId,
    } = req.body || {};

    if (!ticker) {
      return this.handleError(res, 'ticker is required', 400);
    }

    const trade = await prisma.trade.create({
      data: {
        userId,
        ticker: String(ticker).toUpperCase(),
        strategy: strategy ?? null,
        entryTime: entryTime ? new Date(entryTime) : null,
        exitTime: exitTime ? new Date(exitTime) : null,
        direction: direction ?? null,
        entryPrice: entryPrice != null ? Number(entryPrice) : null,
        stopLoss: stopLoss != null ? Number(stopLoss) : null,
        takeProfit: takeProfit != null ? Number(takeProfit) : null,
        lot: lot != null ? Number(lot) : null,
        riskPercent: riskPercent != null ? Number(riskPercent) : null,
        profit: profit != null ? Number(profit) : null,
        emotion: emotion ?? null,
        isPlanned: Boolean(isPlanned) || false,
        planId: planId ?? null,
      },
    });

    return this.handleSuccess(res, trade, 201);
  });

  public updateTrade = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();
    const id = String(req.params.id || '');
    if (!id) return this.handleError(res, 'id is required', 400);

    const existing = await prisma.trade.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) return this.handleError(res, 'Trade not found', 404);

    const {
      ticker,
      strategy,
      entryTime,
      exitTime,
      direction,
      entryPrice,
      stopLoss,
      takeProfit,
      lot,
      riskPercent,
      profit,
      emotion,
      isPlanned,
      planId,
    } = req.body || {};

    const updated = await prisma.trade.update({
      where: { id },
      data: {
        ...(ticker != null && { ticker: String(ticker).toUpperCase() }),
        strategy: strategy ?? undefined,
        entryTime: entryTime != null ? new Date(entryTime) : undefined,
        exitTime: exitTime != null ? new Date(exitTime) : undefined,
        direction: direction ?? undefined,
        entryPrice: entryPrice != null ? Number(entryPrice) : undefined,
        stopLoss: stopLoss != null ? Number(stopLoss) : undefined,
        takeProfit: takeProfit != null ? Number(takeProfit) : undefined,
        lot: lot != null ? Number(lot) : undefined,
        riskPercent: riskPercent != null ? Number(riskPercent) : undefined,
        profit: profit != null ? Number(profit) : undefined,
        emotion: emotion ?? undefined,
        isPlanned: isPlanned != null ? Boolean(isPlanned) : undefined,
        planId: planId ?? undefined,
      },
    });

    return this.handleSuccess(res, updated);
  });

  public deleteTrade = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();
    const id = String(req.params.id || '');
    if (!id) return this.handleError(res, 'id is required', 400);

    const existing = await prisma.trade.findFirst({ where: { id, userId, deletedAt: null } });
    if (!existing) return this.handleError(res, 'Trade not found', 404);

    await prisma.trade.update({ where: { id }, data: { deletedAt: new Date() } });
    return this.handleSuccess(res, { id, deleted: true });
  });

  public listAudit = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();
    const { entityType, entityId, limit = '50', cursor } = req.query as Record<string, string>;
    const take = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 500);

    const where: any = { userId };
    if (entityType) where.entityType = String(entityType);
    if (entityId) where.entityId = String(entityId);

    const query: any = {
      where,
      orderBy: { timestamp: 'desc' },
      take,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        before: true,
        after: true,
        timestamp: true,
      },
    };
    if (cursor) {
      query.cursor = { id: String(cursor) };
      query.skip = 1;
    }

    const items = await prisma.auditLog.findMany(query);
    const nextCursor = items.length === take ? items[items.length - 1].id : null;
    return this.handleSuccess(res, { items, nextCursor });
  });

  public listAnalyses = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();
    const { tradeId, from, to, limit = '50', cursor } = req.query as Record<string, string>;
    const take = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);

    const where: any = { userId, deletedAt: null };
    if (tradeId) where.tradeId = String(tradeId);
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to) where.timestamp.lte = new Date(to);
    }

    const query: any = {
      where,
      orderBy: { timestamp: 'desc' },
      take,
      select: {
        id: true,
        tradeId: true,
        model: true,
        timestamp: true,
        prompt: true,
        response: true,
        metadata: true,
      },
    };
    if (cursor) {
      query.cursor = { id: String(cursor) };
      query.skip = 1;
    }

    const items = await prisma.aIAnalysis.findMany(query);
    const nextCursor = items.length === take ? items[items.length - 1].id : null;
    return this.handleSuccess(res, { items, nextCursor });
  });
}

export default new DbController();
