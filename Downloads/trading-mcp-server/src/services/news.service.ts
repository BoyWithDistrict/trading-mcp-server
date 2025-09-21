import config from '../config';
import logger from '../utils/logger';
import { ProxyAgent, Dispatcher } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

export type NewsItem = {
  symbol?: string;
  time: string; // ISO
  source?: string;
  title: string;
  url: string;
};

class NewsService {
  private apiKey: string;
  private language: string;
  private maxPerSymbol: number;
  private timeoutMs: number;
  private proxyDispatcher?: Dispatcher;
  private enabled: boolean;

  constructor() {
    this.apiKey = config.api.news.newsApiKey;
    this.language = config.api.news.defaults.language;
    this.maxPerSymbol = config.api.news.defaults.maxPerSymbol;
    this.timeoutMs = config.api.news.defaults.timeoutMs;
    this.enabled = !!config.api.news.enabled;

    const proxyUrl = config.api.news.proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxyUrl) {
      try {
        if (/^socks/i.test(proxyUrl)) {
          this.proxyDispatcher = new SocksProxyAgent(proxyUrl) as unknown as Dispatcher;
          logger.info('SOCKS proxy detected for NewsService. Using SocksProxyAgent');
        } else {
          this.proxyDispatcher = new ProxyAgent(proxyUrl);
          logger.info('HTTP proxy detected for NewsService. Using ProxyAgent');
        }
      } catch (e) {
        logger.warn('Failed to initialize ProxyAgent for NewsService. Proceeding without proxy.', { error: String(e) });
      }
    }
  }

  private isTransientError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase();
    return /(fetch failed|econnreset|eai_again|enotfound|etimedout|und_err_connect_timeout|aborted|network timeout)/i.test(msg);
  }

  private async fetchWithRetry<T>(url: string, retries = 1, backoffMs = 300): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await this.fetchJson<T>(url);
      } catch (e) {
        attempt++;
        const transient = this.isTransientError(e);
        if (!transient || attempt > retries) {
          throw e;
        }
        logger.warn(`NewsService transient error, retrying after ${backoffMs}ms`, { error: String((e as any)?.message || e) });
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  public isEnabled(): boolean {
    return this.enabled && !!this.apiKey;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'X-Api-Key': this.apiKey,
        },
        signal: controller.signal,
        // @ts-ignore (undici fetch supports dispatcher option)
        dispatcher: this.proxyDispatcher,
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

  /**
   * Получить новости по списку символов за период.
   * Для экономии токенов возвращаем по maxPerSymbol новостей на символ (сортировка по убыванию даты).
   */
  public async getNewsDigest(symbols: string[], fromIso: string, toIso: string): Promise<Record<string, NewsItem[]>> {
    if (!this.isEnabled() || symbols.length === 0) return {};

    const out: Record<string, NewsItem[]> = {};
    const base = 'https://newsapi.org/v2/everything';

    const list = [...new Set(symbols)];
    const CONCURRENCY = Math.min(2, Math.max(1, list.length));
    let idx = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= list.length) break;
        const sym = list[i];
        try {
          const q = encodeURIComponent(sym.replace(/\//g, ' '));
          const params = new URLSearchParams({
            q,
            from: new Date(fromIso).toISOString(),
            to: new Date(toIso).toISOString(),
            language: this.language,
            sortBy: 'publishedAt',
            pageSize: String(this.maxPerSymbol),
          });
          const url = `${base}?${params.toString()}`;
          const json = await this.fetchWithRetry<any>(url, 1, 300);
          const items = Array.isArray(json.articles) ? json.articles : [];
          out[sym] = items.slice(0, this.maxPerSymbol).map((a: any) => ({
            symbol: sym,
            time: a.publishedAt || new Date().toISOString(),
            source: a?.source?.name || undefined,
            title: String(a?.title || '').slice(0, 300),
            url: a?.url || '',
          }));
        } catch (e) {
          logger.warn('NewsService getNewsDigest failed for symbol', { symbol: sym, error: String((e as any)?.message || e) });
        }
      }
    };
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    return out;
  }
}

export default new NewsService();
