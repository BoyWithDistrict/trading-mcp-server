import { MarketCandle } from '../types/market';

function toNumber(n: any): number | null {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
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
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const up = Math.max(0, change);
    const down = Math.max(0, -change);
    if (i <= period) {
      gain += up;
      loss += down;
      out.push(NaN);
      continue;
    }
    if (i === period + 1) {
      gain /= period;
      loss /= period;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
    const rs = loss === 0 ? 100 : gain / loss;
    const rsi = 100 - 100 / (1 + rs);
    out.push(rsi);
  }
  // align length
  if (out.length < closes.length) {
    out.unshift(...Array(closes.length - out.length).fill(NaN));
  }
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
