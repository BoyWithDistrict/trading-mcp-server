import { MarketCandle } from '../types/market';

function toNumber(n: any): number | null {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

export function sma(values: number[], period: number): number[] {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      out.push(NaN);
      continue;
    }
    sum += v;
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out.push(sum / period);
    else out.push(NaN);
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) {
      out.push(prev ?? NaN);
      continue;
    }
    if (prev == null) {
      prev = v;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out: number[] = [];
  if (closes.length === 0) return out;
  let avgGain = 0;
  let avgLoss = 0;
  // сначала накапливаем первые period изменений без вывода значений
  for (let i = 1; i <= Math.min(period, closes.length - 1); i++) {
    const change = closes[i] - closes[i - 1];
    avgGain += Math.max(0, change);
    avgLoss += Math.max(0, -change);
    out.push(NaN);
  }
  if (closes.length <= period) {
    // недостаточно данных для первого RSI
    // выравниваем длину
    if (out.length < closes.length) out.unshift(...Array(closes.length - out.length).fill(NaN));
    return out;
  }
  // первая точка RSI
  avgGain /= period;
  avgLoss /= period;
  {
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi0 = 100 - 100 / (1 + rs);
    out.push(rsi0);
  }
  // последующие точки с эксп. сглаживанием
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsiVal = 100 - 100 / (1 + rs);
    out.push(rsiVal);
  }
  // выравниваем длину до closes.length
  if (out.length < closes.length) out.unshift(...Array(closes.length - out.length).fill(NaN));
  return out;
}

export function atr(candles: MarketCandle[], period = 14): number[] {
  const out: number[] = [];
  let prevClose: number | null = null;
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const high = toNumber(c.h);
    const low = toNumber(c.l);
    const close = toNumber(c.c);
    if (high == null || low == null || close == null) {
      trs.push(NaN);
      continue;
    }
    const tr = prevClose == null ? high - low : Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
    prevClose = close;
  }
  // Wilder's smoothing for ATR
  let prevAtr: number | null = null;
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    if (!Number.isFinite(tr)) {
      out.push(NaN);
      continue;
    }
    if (i < period) {
      out.push(NaN);
      continue;
    }
    if (i === period) {
      // first ATR is SMA of first period TRs
      const window = trs.slice(1, period + 1); // skip index 0 to align with classic formula
      const sma = window.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) / window.length;
      prevAtr = sma;
      out.push(prevAtr);
      continue;
    }
    if (prevAtr == null) {
      out.push(NaN);
      continue;
    }
    prevAtr = (prevAtr * (period - 1) + tr) / period;
    out.push(prevAtr);
  }
  return out;
}

export type IndicatorSummary = {
  lastRsi?: number;
  lastAtrPct?: number; // ATR / close
  ema200Slope?: 'up' | 'down' | 'flat';
};

export function summarizeIndicators(candles: MarketCandle[]): IndicatorSummary {
  const closes = candles.map((c) => Number(c.c)).filter(Number.isFinite);
  if (closes.length < 5) return {};
  const ema200Arr = ema(closes, 200);
  const rsiArr = rsi(closes, 14);
  const atrArr = atr(candles, 14);
  const lastClose = closes[closes.length - 1];
  const lastAtr = atrArr[atrArr.length - 1];
  const lastRsi = rsiArr[rsiArr.length - 1];
  let ema200Slope: 'up' | 'down' | 'flat' | undefined;
  if (ema200Arr.length >= 3) {
    const a = ema200Arr[ema200Arr.length - 3];
    const b = ema200Arr[ema200Arr.length - 2];
    const c = ema200Arr[ema200Arr.length - 1];
    if ([a, b, c].every((v) => Number.isFinite(v))) {
      const slope = c - a;
      const thr = (Math.abs(c) || 1) * 0.0005; // 5 bps как порог
      ema200Slope = slope > thr ? 'up' : slope < -thr ? 'down' : 'flat';
    }
  }
  const lastAtrPct = Number.isFinite(lastAtr) && Number.isFinite(lastClose) && lastClose !== 0 ? lastAtr / lastClose : undefined;
  return {
    lastRsi: Number.isFinite(lastRsi) ? Number(lastRsi.toFixed(2)) : undefined,
    lastAtrPct: Number.isFinite(lastAtrPct) ? Number((lastAtrPct as number).toFixed(4)) : undefined,
    ema200Slope,
  };
}

// --- Индикаторы на момент сделки ---
export type IndicatorSnapshot = {
  timeIndex: number;
  time: number;
  close?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  rsi14?: number;
  atr14?: number;
  atrPct?: number;
  ema200Slope?: 'up' | 'down' | 'flat';
  closeVsEma200Bps?: number; // (close/ema200 - 1) * 10000
};

/**
 * Находит индекс свечи с временем <= заданного (в мс). Если все свечи позже — возвращает 0, если раньше — последний индекс.
 */
export function findCandleIndexAtOrBefore(candles: MarketCandle[], timestampMs: number): number {
  if (!candles.length) return -1;
  let lo = 0, hi = candles.length - 1;
  if (timestampMs <= Number(candles[0].t)) return 0;
  if (timestampMs >= Number(candles[hi].t)) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = Number(candles[mid].t);
    if (t === timestampMs) return mid;
    if (t < timestampMs) lo = mid + 1; else hi = mid - 1;
  }
  return Math.max(0, lo - 1);
}

function dirFromSlope(vs: number[], lookback = 2): 'up' | 'down' | 'flat' | undefined {
  if (!vs.length) return undefined;
  const i = vs.length - 1;
  const j = Math.max(0, i - lookback);
  const a = vs[j];
  const c = vs[i];
  if (!Number.isFinite(a) || !Number.isFinite(c)) return undefined;
  const slope = c - a;
  const thr = (Math.abs(c) || 1) * 0.0005;
  return slope > thr ? 'up' : slope < -thr ? 'down' : 'flat';
}

function buildSeries(candles: MarketCandle[]) {
  const closes = candles.map((c) => Number(c.c));
  const ema20Arr = ema(closes, 20);
  const ema50Arr = ema(closes, 50);
  const ema200Arr = ema(closes, 200);
  const sma20Arr = sma(closes, 20);
  const sma50Arr = sma(closes, 50);
  const sma200Arr = sma(closes, 200);
  const rsi14Arr = rsi(closes, 14);
  const atr14Arr = atr(candles, 14);
  return { closes, ema20Arr, ema50Arr, ema200Arr, sma20Arr, sma50Arr, sma200Arr, rsi14Arr, atr14Arr };
}

export function getIndicatorsAt(candles: MarketCandle[], timestamp: number | string): IndicatorSnapshot | undefined {
  if (!Array.isArray(candles) || candles.length === 0) return undefined;
  const ts = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (!Number.isFinite(ts)) return undefined;
  const idx = findCandleIndexAtOrBefore(candles, ts);
  if (idx < 0) return undefined;
  const series = buildSeries(candles);
  const time = Number(candles[idx].t);
  const close = Number(series.closes[idx]);
  const ema20v = series.ema20Arr[idx];
  const ema50v = series.ema50Arr[idx];
  const ema200v = series.ema200Arr[idx];
  const sma20v = series.sma20Arr[idx];
  const sma50v = series.sma50Arr[idx];
  const sma200v = series.sma200Arr[idx];
  const rsi14v = series.rsi14Arr[idx];
  const atr14v = series.atr14Arr[idx];
  const atrPct = Number.isFinite(atr14v) && Number.isFinite(close) && close !== 0 ? atr14v / close : undefined;
  const ema200Slope = dirFromSlope(series.ema200Arr);
  const closeVsEma200Bps = Number.isFinite(close) && Number.isFinite(ema200v) && (ema200v as number) !== 0
    ? ((close / (ema200v as number)) - 1) * 10000
    : undefined;
  return {
    timeIndex: idx,
    time,
    close: Number.isFinite(close) ? Number(close.toFixed(6)) : undefined,
    ema20: Number.isFinite(ema20v) ? Number((ema20v as number).toFixed(6)) : undefined,
    ema50: Number.isFinite(ema50v) ? Number((ema50v as number).toFixed(6)) : undefined,
    ema200: Number.isFinite(ema200v) ? Number((ema200v as number).toFixed(6)) : undefined,
    sma20: Number.isFinite(sma20v) ? Number((sma20v as number).toFixed(6)) : undefined,
    sma50: Number.isFinite(sma50v) ? Number((sma50v as number).toFixed(6)) : undefined,
    sma200: Number.isFinite(sma200v) ? Number((sma200v as number).toFixed(6)) : undefined,
    rsi14: Number.isFinite(rsi14v) ? Number((rsi14v as number).toFixed(2)) : undefined,
    atr14: Number.isFinite(atr14v) ? Number((atr14v as number).toFixed(6)) : undefined,
    atrPct: Number.isFinite(atrPct) ? Number((atrPct as number).toFixed(4)) : undefined,
    ema200Slope,
    closeVsEma200Bps: Number.isFinite(closeVsEma200Bps) ? Number((closeVsEma200Bps as number).toFixed(2)) : undefined,
  };
}

export function getIndicatorsSnapshot(candles: MarketCandle[], entryTime?: number | string, exitTime?: number | string) {
  const entry = entryTime != null ? getIndicatorsAt(candles, entryTime) : undefined;
  const exit = exitTime != null ? getIndicatorsAt(candles, exitTime) : undefined;
  return { entry, exit };
}
