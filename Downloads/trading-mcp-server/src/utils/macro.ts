export type TimeValue = { time: string; value: number };
export type Series = { series?: TimeValue[]; meta?: any } | undefined;

export function trimSeriesN(s: Series, n: number): Series {
  if (!s || !Array.isArray(s.series)) return s;
  const len = s.series.length;
  return { ...s, series: s.series.slice(Math.max(0, len - Math.max(1, n))) };
}

export function latestOf(s: Series) {
  if (!s || !Array.isArray(s.series) || s.series.length === 0) return undefined;
  return s.series[s.series.length - 1];
}

export function prevOf(s: Series) {
  if (!s || !Array.isArray(s.series) || s.series.length < 2) return undefined;
  return s.series[s.series.length - 2];
}

export function yoyOf(s: Series) {
  if (!s || !Array.isArray(s.series) || s.series.length < 13) return undefined;
  const latest = s.series[s.series.length - 1];
  const ago = s.series[s.series.length - 13];
  if (!latest || !ago) return undefined;
  const abs = latest.value - ago.value;
  const pct = ago.value !== 0 ? (abs / ago.value) * 100 : undefined;
  return { abs, pct };
}

export function buildMacroSummaryUS(us: { cpi?: Series; unemployment?: Series; policyRate?: Series; gdp?: Series }) {
  const cpiLast = latestOf(us.cpi);
  const cpiYoY = yoyOf(us.cpi);
  const unLast = latestOf(us.unemployment);
  const unPrev = prevOf(us.unemployment);
  const rateLast = latestOf(us.policyRate);
  const ratePrev = prevOf(us.policyRate);
  const gdpLast = latestOf(us.gdp);
  const gdpPrev = prevOf(us.gdp);
  return {
    US: {
      cpi: cpiLast ? { date: cpiLast.time, value: cpiLast.value, yoyPct: cpiYoY?.pct } : undefined,
      unemployment: unLast ? { date: unLast.time, value: unLast.value, delta: (unPrev ? unLast.value - unPrev.value : undefined) } : undefined,
      policyRate: rateLast ? { date: rateLast.time, value: rateLast.value, delta: (ratePrev ? rateLast.value - ratePrev.value : undefined) } : undefined,
      gdp: gdpLast ? { date: gdpLast.time, value: gdpLast.value, delta: (gdpPrev ? gdpLast.value - gdpPrev.value : undefined) } : undefined,
    },
  };
}
