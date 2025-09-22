import { Router, Request, Response } from 'express';
import fredService from '../services/fred.service';
import logger from '../utils/logger';
import { persistMacroData } from '../services/macro-cache.service';

const router = Router();

// POST /api/admin/macro/refresh?country=US&months=13
router.post('/macro/refresh', async (req: Request, res: Response) => {
  try {
    const country = String(req.query.country || 'US').toUpperCase();
    const months = Math.max(1, Number(req.query.months || 13));

    const to = new Date();
    const from = new Date(to.getTime());
    from.setMonth(from.getMonth() - months);

    if (country !== 'US') {
      return res.status(400).json({ success: false, error: `country '${country}' is not supported yet (only US)` });
    }

    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    logger.info('Admin: refreshing FRED macro data', { country, from: fromIso, to: toIso, months });

    const data = await fredService.getMacroDataUS(fromIso, toIso);
    const sizes = Object.fromEntries(
      Object.entries(data || {}).map(([k, v]: any) => [k, Array.isArray(v?.series) ? v.series.length : 0])
    );

    try {
      await persistMacroData(data as any);
    } catch (e) {
      logger.warn('Admin: persistMacroData failed (non-fatal)', { error: String(e) });
    }

    return res.json({ success: true, country, from: fromIso, to: toIso, sizes });
  } catch (e: any) {
    logger.error('Admin macro refresh failed', { error: String(e?.message || e) });
    return res.status(500).json({ success: false, error: 'macro refresh failed', message: String(e?.message || e) });
  }
});

export default router;
