import { Request, Response } from 'express';
import { BaseController } from './base.controller';
import prisma from '../services/prisma';
import { getOrCreateDemoUserId } from '../services/user.service';

function toDateOrUndefined(v?: string) {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

function msToDuration(ms: number) {
  const minutes = Math.round(ms / 60000);
  return { minutes };
}

// ISO week helpers
function getISOWeek(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // 1..7, Mon=1
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d as any) - (yearStart as any)) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

export class MetricsController extends BaseController {
  public summary = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();
    const { symbol, from, to } = req.query as Record<string, string>;

    const where: any = { userId, deletedAt: null };
    if (symbol) where.ticker = String(symbol).toUpperCase();
    const fromD = toDateOrUndefined(from);
    const toD = toDateOrUndefined(to);
    if (fromD || toD) {
      where.entryTime = {};
      if (fromD) where.entryTime.gte = fromD;
      if (toD) where.entryTime.lte = toD;
    }

    const trades = await prisma.trade.findMany({ where });

    const tradesCount = trades.length;
    const profits = trades.map(t => Number(t.profit || 0));
    const totalProfit = profits.reduce((a, b) => a + b, 0);
    const wins = profits.filter(p => p > 0).length;
    const winRate = tradesCount ? wins / tradesCount : 0;
    const avgProfit = tradesCount ? totalProfit / tradesCount : 0;

    const holdTimes = trades
      .filter(t => t.entryTime && t.exitTime)
      .map(t => (t.exitTime!.getTime() - t.entryTime!.getTime()));
    const avgHoldMs = holdTimes.length ? Math.round(holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length) : 0;

    return this.handleSuccess(res, {
      tradesCount,
      wins,
      winRate,
      totalProfit,
      avgProfit,
      avgHoldTime: msToDuration(avgHoldMs),
    });
  });

  public pnlWeekly = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();
    const { symbol, from, to } = req.query as Record<string, string>;

    const where: any = { userId, deletedAt: null };
    if (symbol) where.ticker = String(symbol).toUpperCase();
    const fromD = toDateOrUndefined(from);
    const toD = toDateOrUndefined(to);
    if (fromD || toD) {
      where.entryTime = {};
      if (fromD) where.entryTime.gte = fromD;
      if (toD) where.entryTime.lte = toD;
    }

    const trades = await prisma.trade.findMany({ where });

    // Group by ISO week
    const buckets = new Map<string, { year: number; week: number; totalProfit: number; trades: number }>();
    for (const t of trades) {
      const d = t.entryTime ? new Date(t.entryTime) : null;
      if (!d) continue;
      const { year, week } = getISOWeek(d);
      const key = `${year}-W${String(week).padStart(2, '0')}`;
      const b = buckets.get(key) || { year, week, totalProfit: 0, trades: 0 };
      b.totalProfit += Number(t.profit || 0);
      b.trades += 1;
      buckets.set(key, b);
    }

    const items = Array.from(buckets.values()).sort((a, b) =>
      a.year === b.year ? a.week - b.week : a.year - b.year
    );

    return this.handleSuccess(res, { items });
  });

  public drawdown = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();
    const { symbol, from, to } = req.query as Record<string, string>;

    const where: any = { userId, deletedAt: null };
    if (symbol) where.ticker = String(symbol).toUpperCase();
    const fromD = toDateOrUndefined(from);
    const toD = toDateOrUndefined(to);
    if (fromD || toD) {
      where.entryTime = {};
      if (fromD) where.entryTime.gte = fromD;
      if (toD) where.entryTime.lte = toD;
    }

    const trades = await prisma.trade.findMany({ where, orderBy: { entryTime: 'asc' } });
    let equity = 0;
    let peak = 0;
    let maxDD = 0;
    const curve: Array<{ t: string; equity: number; dd: number }> = [];
    for (const t of trades) {
      equity += Number(t.profit || 0);
      peak = Math.max(peak, equity);
      const dd = peak - equity; // абсолютная просадка
      if (dd > maxDD) maxDD = dd;
      curve.push({ t: (t.entryTime || new Date()).toISOString(), equity, dd });
    }
    const maxDrawdown = maxDD;
    const maxDrawdownPct = peak > 0 ? (maxDD / peak) : 0;
    return this.handleSuccess(res, { maxDrawdown, maxDrawdownPct, points: curve });
  });

  public pnlDaily = this.asyncHandler(async (req: Request, res: Response) => {
    const userId = await getOrCreateDemoUserId();
    const { symbol, from, to } = req.query as Record<string, string>;

    const where: any = { userId, deletedAt: null };
    if (symbol) where.ticker = String(symbol).toUpperCase();
    const fromD = toDateOrUndefined(from);
    const toD = toDateOrUndefined(to);
    if (fromD || toD) {
      where.entryTime = {};
      if (fromD) where.entryTime.gte = fromD;
      if (toD) where.entryTime.lte = toD;
    }

    const trades = await prisma.trade.findMany({ where });
    const map = new Map<string, { date: string; totalProfit: number; trades: number }>();
    for (const t of trades) {
      const d = t.entryTime ? new Date(t.entryTime) : null;
      if (!d) continue;
      const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      const bucket = map.get(dateKey) || { date: dateKey, totalProfit: 0, trades: 0 };
      bucket.totalProfit += Number(t.profit || 0);
      bucket.trades += 1;
      map.set(dateKey, bucket);
    }
    const items = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    return this.handleSuccess(res, { items });
  });
}

export default new MetricsController();
