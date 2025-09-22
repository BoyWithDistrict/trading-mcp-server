import logger from '../utils/logger';
import { ProxyAgent, Dispatcher } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

export type TimeValue = { time: string; value: number };
export type MacroSeries = { series: TimeValue[]; meta?: { country?: string; unit?: string; name?: string } };

class FredService {
  private apiKey: string;
  private timeoutMs: number;
  private maxRetries: number;
  private proxyDispatcher?: Dispatcher;

  constructor() {
    this.apiKey = process.env.FRED_API_KEY || '';
    this.timeoutMs = Number(process.env.FRED_TIMEOUT_MS || 15000);
    this.maxRetries = Number(process.env.FRED_MAX_RETRIES || 2);

    const proxyUrl = process.env.FRED_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxyUrl) {
      try {
        if (/^socks/i.test(proxyUrl)) {
          this.proxyDispatcher = new SocksProxyAgent(proxyUrl) as unknown as Dispatcher;
          logger.info('SOCKS proxy detected for FredService. Using SocksProxyAgent');
        } else {
          this.proxyDispatcher = new ProxyAgent(proxyUrl);
          logger.info('HTTP proxy detected for FredService. Using ProxyAgent');
        }
      } catch (e) {
        logger.warn('Failed to initialize ProxyAgent for FredService. Proceeding without proxy.', { error: String(e) });
      }
    }
  }

  public isEnabled(): boolean { return !!this.apiKey; }

  private isTransientError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase();
    return /(fetch failed|econnreset|eai_again|enotfound|etimedout|und_err_connect_timeout|aborted|network timeout)/i.test(msg);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // Determine per-request dispatcher considering NO_PROXY
      let dispatcher: Dispatcher | undefined = this.proxyDispatcher;
      try {
        const host = new URL(url).hostname.toLowerCase();
        const noProxy = String(process.env.NO_PROXY || '')
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean);
        const shouldBypass = noProxy.some(pattern => {
          if (pattern === '*') return true;
          if (host === pattern) return true;
          // suffix match: .domain.com matches sub.domain.com
          if (pattern.startsWith('.')) return host.endsWith(pattern);
          // plain token: allow suffix match as well
          return host === pattern || host.endsWith(`.${pattern}`);
        });
        if (shouldBypass) dispatcher = undefined;
      } catch {}
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
        // @ts-ignore
        dispatcher,
      });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`HTTP ${r.status} ${r.statusText} - ${body}`);
      }
      return (await r.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchWithRetry<T>(url: string, retries = this.maxRetries, backoffMs = 300): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await this.fetchJson<T>(url);
      } catch (e) {
        attempt++;
        const transient = this.isTransientError(e);
        if (!transient || attempt > retries) throw e;
        const wait = Math.round(backoffMs * Math.pow(1.8, attempt - 1));
        logger.warn(`FRED transient error, retrying after ${wait}ms`, { error: String((e as any)?.message || e) });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  // Map logical metric to FRED series_id for US
  private seriesMapUS(): Record<string, { id: string; name: string; unit?: string }> {
    return {
      // CPI: CPIAUCSL (Index 1982-84=100, SA)
      cpi: { id: 'CPIAUCSL', name: 'CPI (All Urban, SA, 1982-84=100)' },
      // Real GDP (Chained 2017 Dollars), quarterly, GDPC1
      gdp: { id: 'GDPC1', name: 'Real GDP (Chained 2017 Dollars)' },
      // Federal Funds Rate (Effective) FEDFUNDS
      policyRate: { id: 'FEDFUNDS', name: 'Federal Funds Rate (Effective)', unit: '%' },
      // Unemployment rate UNRATE
      unemployment: { id: 'UNRATE', name: 'Unemployment Rate', unit: '%' },
    };
  }

  private toIsoDate(d: string): string {
    // FRED returns YYYY-MM-DD
    try { return new Date(d + 'T00:00:00Z').toISOString(); } catch { return new Date(d).toISOString(); }
  }

  private async getSeries(seriesId: string, prettyName: string, country: string): Promise<MacroSeries | undefined> {
    const base = 'https://api.stlouisfed.org/fred/series/observations';
    const url = `${base}?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(this.apiKey)}&file_type=json`;
    try {
      const json = await this.fetchWithRetry<any>(url);
      const obs = Array.isArray(json?.observations) ? json.observations : [];
      const series: TimeValue[] = obs.map((o: any) => {
        const v = Number(o?.value);
        return { time: this.toIsoDate(String(o?.date || '')), value: isFinite(v) ? v : NaN };
      }).filter(p => isFinite(p.value));
      if (series.length === 0) return undefined;
      return { series, meta: { country, name: prettyName } };
    } catch (e) {
      logger.warn('FRED getSeries failed', { seriesId, error: String((e as any)?.message || e) });
      return undefined;
    }
  }

  public async getMacroDataUS(fromIso: string, toIso: string): Promise<{ cpi?: MacroSeries; gdp?: MacroSeries; policyRate?: MacroSeries; unemployment?: MacroSeries; pmi?: MacroSeries; }> {
    if (!this.isEnabled()) return {};
    const country = 'US';
    const map = this.seriesMapUS();
    const [cpi, gdp, policyRate, unemployment] = await Promise.all([
      this.getSeries(map.cpi.id, 'CPI', country),
      this.getSeries(map.gdp.id, 'GDP (real)', country),
      this.getSeries(map.policyRate.id, 'Policy Rate (Fed Funds)', country),
      this.getSeries(map.unemployment.id, 'Unemployment', country),
    ]);
    // Optionally: filter by from/to
    const clip = (s?: MacroSeries) => s ? { ...s, series: s.series.filter(p => {
      const t = new Date(p.time).getTime();
      return t >= new Date(fromIso).getTime() && t <= new Date(toIso).getTime();
    }) } : undefined;
    return {
      cpi: clip(cpi),
      gdp: clip(gdp),
      policyRate: clip(policyRate),
      unemployment: clip(unemployment),
      pmi: undefined,
    };
  }
}

export default new FredService();
