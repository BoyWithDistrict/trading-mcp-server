import { MacroSeries as FinnhubMacroSeries } from './finnhub.service';
import * as macroRepo from '../repositories/macro.repo';
import logger from '../utils/logger';

export type MacroDataBundle = {
  // key -> series
  cpi?: FinnhubMacroSeries;
  gdp?: FinnhubMacroSeries;
  policyRate?: FinnhubMacroSeries;
  unemployment?: FinnhubMacroSeries;
  pmi?: FinnhubMacroSeries;
};

function makeSeriesCode(country: string | undefined, key: string) {
  const c = (country || 'GLOBAL').toUpperCase();
  const k = key.toUpperCase();
  return `${c}_${k}`; // e.g. US_CPI
}

export function hasAnyData(data: MacroDataBundle | undefined): boolean {
  if (!data) return false;
  const entries = Object.entries(data) as Array<[keyof MacroDataBundle, FinnhubMacroSeries | undefined]>;
  for (const [, series] of entries) {
    if (series && Array.isArray(series.series) && series.series.length > 0) return true;
  }
  return false;
}

export async function loadMacroDataFromDb(country: string, fromIso: string, toIso: string, keys: Array<keyof MacroDataBundle>): Promise<MacroDataBundle> {
  const out: MacroDataBundle = {};
  const from = new Date(fromIso);
  const to = new Date(toIso);
  for (const key of keys) {
    try {
      const code = macroRepo.makeSeriesCode(country, String(key));
      const series = await macroRepo.findSeriesByProviderAndCode('finnhub', code);
      if (!series) continue;
      const obs = await macroRepo.getSeriesObservationsLatest(series.id, from, to);
      if (!obs || obs.length === 0) continue;
      (out as any)[key] = {
        series: obs.map((o) => ({ time: o.date.toISOString(), value: o.value })),
        meta: { country, name: String(key).toUpperCase() },
      } satisfies FinnhubMacroSeries;
    } catch (e) {
      logger.warn('macro-cache: loadMacroDataFromDb failed', { key, error: String(e) });
    }
  }
  return out;
}

export async function persistMacroData(data: MacroDataBundle | undefined) {
  if (!data) return;
  const entries = Object.entries(data) as Array<[keyof MacroDataBundle, FinnhubMacroSeries | undefined]>;
  for (const [key, series] of entries) {
    try {
      if (!series || !Array.isArray(series.series) || series.series.length === 0) continue;
      const code = makeSeriesCode(series.meta?.country, String(key));
      const s = await macroRepo.upsertSeries({
        providerName: 'finnhub',
        code,
        country: series.meta?.country,
        name: series.meta?.name || String(key),
        frequency: undefined,
        unit: series.meta?.unit,
      });
      for (const tv of series.series) {
        const d = new Date(tv.time);
        if (!isFinite(d.getTime())) continue;
        const v = Number(tv.value);
        if (!isFinite(v)) continue;
        await macroRepo.upsertObservation(s.id, d, v, 0);
      }
    } catch (e) {
      logger.warn('macro-cache: persistMacroData failed for key', { key, error: String(e) });
    }
  }
}
