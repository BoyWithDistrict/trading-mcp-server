import { trimSeriesN, latestOf, prevOf, yoyOf, buildMacroSummaryUS, TimeValue } from '../src/utils/macro';

describe('macro utils', () => {
  const mkSeries = (vals: number[], start = new Date('2024-01-01T00:00:00Z')) => {
    const series: TimeValue[] = vals.map((v, i) => ({
      time: new Date(start.getTime() + i * 24 * 60 * 60 * 1000).toISOString(),
      value: v,
    }));
    return { series } as any;
  };

  test('trimSeriesN keeps last N points', () => {
    const s = mkSeries([1, 2, 3, 4, 5]);
    const t = trimSeriesN(s, 3) as any;
    expect(t.series.map((x: any) => x.value)).toEqual([3, 4, 5]);
  });

  test('latestOf and prevOf', () => {
    const s = mkSeries([10, 20, 30]);
    expect(latestOf(s)?.value).toBe(30);
    expect(prevOf(s)?.value).toBe(20);
    const s2 = mkSeries([10]);
    expect(prevOf(s2)).toBeUndefined();
  });

  test('yoyOf returns undefined if <13 points', () => {
    const s = mkSeries([1, 2, 3, 4]);
    expect(yoyOf(s)).toBeUndefined();
  });

  test('yoyOf computes percentage for 13+ points', () => {
    const vals = Array.from({ length: 13 }, (_, i) => 100 + i); // 100..112
    const s = mkSeries(vals);
    const info = yoyOf(s)!;
    expect(Math.round((info.abs + Number.EPSILON) * 100) / 100).toBe(12);
    expect(Math.round((info.pct! + Number.EPSILON) * 100) / 100).toBeCloseTo(12 / 100 * 100, 5);
  });

  test('buildMacroSummaryUS computes fields', () => {
    const cpi = mkSeries([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112]); // 13 pts
    const un  = mkSeries([4.0, 4.1, 4.2]);
    const ff  = mkSeries([5.0, 4.9, 4.8]);
    const gdp = mkSeries([23000, 23100, 23200]);

    const summary = buildMacroSummaryUS({ cpi, unemployment: un, policyRate: ff, gdp });
    expect(summary.US.cpi?.value).toBe(112);
    expect(summary.US.cpi?.yoyPct).toBeCloseTo((112 - 100) / 100 * 100, 5);
    expect(summary.US.unemployment?.delta).toBeCloseTo(4.2 - 4.1, 5);
    expect(summary.US.policyRate?.delta).toBeCloseTo(4.8 - 4.9, 5);
    expect(summary.US.gdp?.delta).toBeCloseTo(23200 - 23100, 5);
  });
});
