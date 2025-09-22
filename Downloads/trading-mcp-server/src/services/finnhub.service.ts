import config from '../config';
import logger from '../utils/logger';
import { ProxyAgent, Dispatcher } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

export type EconomicEvent = {
  time: string; // ISO
  country?: string;
  event: string;
  actual?: string | number | null;
  forecast?: string | number | null;
  previous?: string | number | null;
  impact?: 'low' | 'medium' | 'high' | string;
};

export type TimeValue = { time: string; value: number };
export type MacroSeries = { series: TimeValue[]; meta?: { country?: string; unit?: string; name?: string } };

class FinnhubService {
  private apiKey: string;
  private timeoutMs: number;
  private maxRetries: number;
  private proxyDispatcher?: Dispatcher;
  private cache: Map<string, { expires: number; data: any }>;
  private ttlCalendarMs: number;
  private ttlMacroMs: number;
  private debug: boolean;

  constructor() {
    this.apiKey = process.env.FINNHUB_API_KEY || '';
    this.timeoutMs = Number(process.env.FINNHUB_TIMEOUT_MS || 15000);
    this.maxRetries = Number(process.env.FINNHUB_MAX_RETRIES || 2);
    this.ttlCalendarMs = Number(process.env.FINNHUB_CACHE_TTL_CAL_MS || 6 * 60 * 60 * 1000); // 6h
    this.ttlMacroMs = Number(process.env.FINNHUB_CACHE_TTL_MACRO_MS || 24 * 60 * 60 * 1000); // 24h
    this.cache = new Map();
    this.debug = String(process.env.FINNHUB_DEBUG || '').toLowerCase() === 'true';

    const proxyUrl = process.env.FINNHUB_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxyUrl) {
      try {
        if (/^socks/i.test(proxyUrl)) {
          this.proxyDispatcher = new SocksProxyAgent(proxyUrl) as unknown as Dispatcher;
          logger.info('SOCKS proxy detected for FinnhubService. Using SocksProxyAgent');
        } else {
          this.proxyDispatcher = new ProxyAgent(proxyUrl);
          logger.info('HTTP proxy detected for FinnhubService. Using ProxyAgent');
        }
      } catch (e) {
        logger.warn('Failed to initialize ProxyAgent for FinnhubService. Proceeding without proxy.', { error: String(e) });
      }
    }
  }

  // Простые утилиты кэша (in-memory, TTL)
  private cacheKey(parts: any[]): string {
    return parts
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join('|');
  }

  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expires > Date.now()) return entry.data as T;
    this.cache.delete(key);
    return undefined;
  }

  private setToCache<T>(key: string, data: T, ttlMs: number): void {
    this.cache.set(key, { expires: Date.now() + ttlMs, data });
  }

  public isEnabled(): boolean {
    return !!this.apiKey;
  }

  private isTransientError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase();
    return /(fetch failed|econnreset|eai_again|enotfound|etimedout|und_err_connect_timeout|aborted|network timeout)/i.test(msg);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        // @ts-ignore
        dispatcher: this.proxyDispatcher,
        signal: controller.signal,
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
        logger.warn(`Finnhub transient error, retrying after ${wait}ms`, { error: String((e as any)?.message || e) });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  private toDateOnly(iso: string): string {
    const d = new Date(iso);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const da = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  public async getEconomicCalendar(fromIso: string, toIso: string, impacts: Array<'high'|'medium'|'low'> = ['high','medium']): Promise<EconomicEvent[]> {
    if (!this.isEnabled()) return [];
    const base = 'https://finnhub.io/api/v1/calendar/economic';
    const from = this.toDateOnly(fromIso);
    const to = this.toDateOnly(toIso);
    const url = `${base}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(this.apiKey)}`;

    const key = this.cacheKey(['cal', from, to, impacts]);
    const cached = this.getFromCache<EconomicEvent[]>(key);
    if (cached && !this.debug) return cached;
    if (this.debug && cached) {
      logger.info('Finnhub.getEconomicCalendar bypassing cache due to debug', { from, to });
    }

    try {
      const json = await this.fetchWithRetry<any>(url);
      const items: any[] = (json?.economicCalendar || json?.economic || json?.data || []);
      const out: EconomicEvent[] = items.map((e: any) => {
        // Finnhub возвращает время как UTC timestamp или date + time. Нормализуем в ISO.
        const ts = e?.time || e?.timestamp || e?.date || e?.dateTime;
        const iso = ts ? new Date(ts).toISOString() : new Date().toISOString();
        const impact: string = (e?.impact || e?.importance || '').toString().toLowerCase();
        return {
          time: iso,
          country: e?.country || e?.region || undefined,
          event: String(e?.event || e?.title || e?.name || 'Unknown'),
          actual: e?.actual ?? e?.actualValue ?? null,
          forecast: e?.forecast ?? e?.estimate ?? null,
          previous: e?.previous ?? e?.prior ?? null,
          impact,
        } as EconomicEvent;
      }).filter((ev) => impacts.length ? impacts.includes(String(ev.impact || '').toLowerCase() as any) : true);
      this.setToCache(key, out, this.ttlCalendarMs);
      if (this.debug) {
        const rawCount = Array.isArray(items) ? items.length : 0;
        logger.info('Finnhub.getEconomicCalendar fetched', { from, to, count: out.length, rawCount, url });
      }
      return out;
    } catch (e) {
      logger.warn('Finnhub getEconomicCalendar failed', { from, to, url, error: String((e as any)?.message || e) });
      return [];
    }
  }

  public async getMacroData(fromIso: string, toIso: string): Promise<{ cpi?: MacroSeries; gdp?: MacroSeries; policyRate?: MacroSeries; unemployment?: MacroSeries; pmi?: MacroSeries; }> {
    if (!this.isEnabled()) {
      if (this.debug) logger.info('Finnhub.getMacroData skipped: API key missing');
      return {};
    }

    // Для простоты запрашиваем по США (US) как наиболее частому кейсу. При необходимости расширим по странам.
    const country = 'US';

    const key = this.cacheKey(['macro', country, this.toDateOnly(fromIso), this.toDateOnly(toIso)]);
    const cached = this.getFromCache<any>(key);
    if (cached && !this.debug) return cached;
    if (this.debug && cached) {
      logger.info('Finnhub.getMacroData bypassing cache due to debug', { country, from: this.toDateOnly(fromIso), to: this.toDateOnly(toIso) });
    }
    if (this.debug) {
      logger.info('Finnhub.getMacroData start', { country, from: this.toDateOnly(fromIso), to: this.toDateOnly(toIso), apiKeyPresent: !!this.apiKey });
    }

    // Используем Finnhub economic endpoint: /economic?country=US&indicator=<code>
    const fetchSeriesOnce = async (indicator: string, prettyName: string): Promise<MacroSeries | undefined> => {
      const base = 'https://finnhub.io/api/v1/economic';
      const url = `${base}?country=${encodeURIComponent(country)}&indicator=${encodeURIComponent(indicator)}&token=${encodeURIComponent(this.apiKey)}`;
      try {
        const json = await this.fetchWithRetry<any>(url);
        const raw: any[] = json?.data || json?.series || json?.result || [];
        const series: TimeValue[] = raw.map((r: any) => {
          const t = r?.time || r?.date || r?.period || r?.t;
          const v = Number(r?.value ?? r?.v ?? r?.val);
          return { time: new Date(t).toISOString(), value: isFinite(v) ? v : NaN };
        }).filter((p) => isFinite(p.value));
        if (this.debug) {
          const keys = Object.keys(json || {});
          logger.info('Finnhub.getMacroData indicator fetched', { indicator, url, length: series.length, jsonKeys: keys.slice(0, 10) });
        }
        return { series, meta: { country, name: prettyName } };
      } catch (e) {
        logger.warn('Finnhub getMacroData indicator failed', { indicator, url, error: String((e as any)?.message || e) });
        return undefined;
      }
    };

    const tryIndicators = async (candidates: string[], prettyName: string): Promise<MacroSeries | undefined> => {
      for (const ind of candidates) {
        const res = await fetchSeriesOnce(ind, prettyName);
        const len = res?.series?.length || 0;
        if (this.debug) {
          logger.info('Finnhub.getMacroData indicator attempt', { indicator: ind, prettyName, length: len });
        }
        if (len > 0) return res;
      }
      return undefined;
    };

    const [cpi, gdp, policyRate, unemployment, pmi] = await Promise.all([
      tryIndicators(['cpi', 'core_cpi', 'cpi_yoy', 'cpi_mom'], 'CPI'),
      tryIndicators(['gdp', 'gdp_yoy', 'gdp_growth', 'gdp_current_usd'], 'GDP'),
      tryIndicators(['policy_rate', 'interest_rate', 'central_bank_rate', 'fed_funds_rate'], 'Policy Rate'),
      tryIndicators(['unemployment_rate', 'unemployment'], 'Unemployment'),
      tryIndicators(['pmi', 'manufacturing_pmi', 'composite_pmi', 'services_pmi'], 'PMI'),
    ]);

    const result = { cpi, gdp, policyRate, unemployment, pmi };
    this.setToCache(key, result, this.ttlMacroMs);
    if (this.debug) {
      const sizes = {
        cpi: cpi?.series?.length || 0,
        gdp: gdp?.series?.length || 0,
        policyRate: policyRate?.series?.length || 0,
        unemployment: unemployment?.series?.length || 0,
        pmi: pmi?.series?.length || 0,
      };
      logger.info('Finnhub.getMacroData fetched', { country, from: this.toDateOnly(fromIso), to: this.toDateOnly(toIso), sizes });
    }
    return result;
  }
}

export default new FinnhubService();
