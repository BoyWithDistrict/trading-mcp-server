import { ema, rsi, atr, sma, getIndicatorsAt, getIndicatorsSnapshot } from '../src/utils/indicators';
import type { MarketCandle } from '../src/types/market';

describe('indicators utils', () => {
  function makeCandles(closes: number[], highs?: number[], lows?: number[]): MarketCandle[] {
    const now = 1_700_000_000_000; // arbitrary
    return closes.map((c, i) => ({
      t: now + i * 60_000,
      o: c,
      h: highs?.[i] ?? c + 0.5,
      l: lows?.[i] ?? c - 0.5,
      c,
      v: 1000,
    } as unknown as MarketCandle));
  }

  test('sma computes simple average and has NaN until window fills', () => {
    const values = [1, 2, 3, 4, 5];
    const out = sma(values, 3);
    expect(out.length).toBe(5);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBeCloseTo((1 + 2 + 3) / 3, 10);
    expect(out[3]).toBeCloseTo((2 + 3 + 4) / 3, 10);
    expect(out[4]).toBeCloseTo((3 + 4 + 5) / 3, 10);
  });

  test('ema length equals input and monotonic on constant series', () => {
    const values = Array.from({ length: 20 }, () => 5);
    const out = ema(values, 10);
    expect(out).toHaveLength(values.length);
    // after warm-up ema should equal constant value
    expect(out[out.length - 1]).toBeCloseTo(5, 10);
  });

  test('rsi computes finite values once enough data and handles small input', () => {
    const small = rsi([1, 2], 14);
    expect(small).toHaveLength(2);
    const values = [1,2,3,2,3,4,5,4,6,7,8,7,8,9,10];
    const r = rsi(values, 14);
    expect(r).toHaveLength(values.length);
    // last rsi should be a finite number
    expect(Number.isFinite(r[r.length - 1])).toBe(true);
  });

  test('atr computes volatility when enough data for period', () => {
    const closes = [10, 11, 12, 11, 10, 9, 9.5, 10];
    const candles = makeCandles(closes);
    const a = atr(candles, 3);
    expect(a).toHaveLength(candles.length);
    // last value should be finite
    expect(Number.isFinite(a[a.length - 1])).toBe(true);
  });

  test('getIndicatorsAt returns snapshot aligned to timestamp', () => {
    const closes = [10, 11, 12, 13, 14, 15];
    const candles = makeCandles(closes);
    const ts = candles[4].t as unknown as number;
    const snap = getIndicatorsAt(candles, ts)!;
    expect(snap).toBeTruthy();
    expect(snap.time).toBe(ts);
    expect(snap.close).toBeCloseTo(14, 10);
    // ema200 will be NaN on short series, but function coerces to undefined
    expect(snap.ema200 === undefined || Number.isFinite(snap.ema200)).toBe(true);
  });

  test('getIndicatorsSnapshot returns entry and exit', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106];
    const candles = makeCandles(closes);
    const entry = (candles[1].t as unknown as number);
    const exit = (candles[5].t as unknown as number);
    const s = getIndicatorsSnapshot(candles, entry, exit);
    expect(s.entry?.time).toBe(entry);
    expect(s.exit?.time).toBe(exit);
  });
});
