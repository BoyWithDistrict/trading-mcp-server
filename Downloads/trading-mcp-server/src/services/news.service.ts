import config from '../config';
import logger from '../utils/logger';
import { ProxyAgent, Dispatcher } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as newsRepo from '../repositories/news.repo';

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
  private baseKeywords: string[];
  private cache: Map<string, { expires: number; data: NewsItem[] }>;
  private cacheTtlMs: number;
  private maxKeywords: number;

  constructor() {
    this.apiKey = config.api.news.newsApiKey;
    this.language = config.api.news.defaults.language;
    this.maxPerSymbol = config.api.news.defaults.maxPerSymbol;
    this.timeoutMs = config.api.news.defaults.timeoutMs;
    this.enabled = !!config.api.news.enabled;

    // Базовый пул ключевых слов (EN), можно дополнить через env NEWSAPI_EXTRA_KEYWORDS (через запятую)
    const DEFAULT_KEYWORDS = [
      'inflation','cpi','ppi','gdp','unemployment','central bank','interest rates','rate hike','rate cut','monetary policy',
      'fed','fomc','powell','treasury yields','core pce','ecb','lagarde','eurozone','pmi','european inflation',
      'forex','eurusd','gbpusd','usdjpy','dxy','dollar index','gold','xau','xauusd','oil','brent','wti','crude','opec'
    ];
    const extra = (process.env.NEWSAPI_EXTRA_KEYWORDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    this.baseKeywords = Array.from(new Set([...DEFAULT_KEYWORDS, ...extra]));

    // Кэш (in-memory)
    this.cacheTtlMs = Number(process.env.NEWS_CACHE_TTL_MS || 45 * 60 * 1000); // 45 минут по умолчанию
    this.cache = new Map();
    this.maxKeywords = Math.max(1, Number(process.env.NEWSAPI_MAX_KEYWORDS || 12));

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
          // Ключ кэша для символа
          const kwKey = this.baseKeywords.join(',').toLowerCase();
          const cacheKey = `${sym}|${new Date(fromIso).toISOString()}|${new Date(toIso).toISOString()}|${this.language}|${this.maxPerSymbol}|${kwKey}`;
          const now = Date.now();
          const cached = this.cache.get(cacheKey);
          if (cached && cached.expires > now) {
            out[sym] = cached.data;
            continue;
          }

          // Read-through: попробовать из БД
          const fromDb = await newsRepo.getArticlesBySymbolAndPeriod(sym, new Date(fromIso), new Date(toIso), this.maxPerSymbol);
          if (fromDb && fromDb.length >= this.maxPerSymbol) {
            const mapped: NewsItem[] = fromDb.map((a: any) => ({
              symbol: sym,
              time: (a.publishedAt instanceof Date ? a.publishedAt : new Date(a.publishedAt)).toISOString(),
              source: a.source || undefined,
              title: String(a.title || '').slice(0, 300),
              url: a.url,
            }));
            out[sym] = mapped;
            this.cache.set(cacheKey, { data: mapped, expires: now + this.cacheTtlMs });
            continue;
          }

          // Запрос 1: по символу
          const q1 = encodeURIComponent(sym.replace(/\//g, ' '));
          // Запрос 2: по расширенному пулу ключевых слов (ограничим по количеству, чтобы не превысить лимит длины запроса у провайдера)
          const limitedKeywords = this.baseKeywords.slice(0, this.maxKeywords);
          const keywordQuery = '(' + limitedKeywords.map(k => `"${k}"`).join(' OR ') + ')';
          const q2 = encodeURIComponent(keywordQuery);

          const commonParams = {
            from: new Date(fromIso).toISOString(),
            to: new Date(toIso).toISOString(),
            language: this.language,
            sortBy: 'publishedAt',
          } as const;

          // Запрашиваем больше, чтобы был смысл скорить (ограничим до 50)
          const pageSize1 = Math.min(Math.max(this.maxPerSymbol * 3, this.maxPerSymbol), 50);
          const pageSize2 = Math.min(Math.max(this.maxPerSymbol * 2, this.maxPerSymbol), 50);

          const params1 = new URLSearchParams({ q: q1, pageSize: String(pageSize1), ...commonParams } as any);
          const params2 = new URLSearchParams({ q: q2, pageSize: String(pageSize2), ...commonParams } as any);
          const url1 = `${base}?${params1.toString()}`;
          const url2 = `${base}?${params2.toString()}`;

          // Последовательно, чтобы не превышать лимиты провайдера; при необходимости можно параллелить
          const json1 = await this.fetchWithRetry<any>(url1, 1, 300);
          const json2 = await this.fetchWithRetry<any>(url2, 1, 300);
          const items1 = Array.isArray(json1.articles) ? json1.articles : [];
          const items2 = Array.isArray(json2.articles) ? json2.articles : [];

          // Дедупликация по URL
          const seen = new Set<string>();
          const merged: any[] = [];
          for (const a of [...items1, ...items2]) {
            const url = a?.url || '';
            if (!url || seen.has(url)) continue;
            seen.add(url);
            merged.push(a);
          }

          // Скоринг релевантности
          const symLower = sym.toLowerCase();
          const kwLower = this.baseKeywords.map(k => k.toLowerCase());
          const fromMs = new Date(commonParams.from).getTime();
          const toMs = new Date(commonParams.to).getTime();
          const spanMs = Math.max(1, toMs - fromMs);

          const scored = merged.map((a: any) => {
            const title = String(a?.title || '');
            const descr = String(a?.description || '');
            const text = (title + ' ' + descr).toLowerCase();
            let score = 0;
            if (text.includes(symLower)) score += 3;
            let hits = 0;
            for (const kw of kwLower) {
              if (kw && text.includes(kw)) { hits++; if (hits >= 5) break; }
            }
            score += hits; // до +5 за ключевые слова
            const t = new Date(a?.publishedAt || Date.now()).getTime();
            const recency = Math.min(1, Math.max(0, (t - fromMs) / spanMs)); // 0..1
            score += recency * 2; // до +2 за свежесть
            return { a, score, t };
          });

          scored.sort((x, y) => (y.score - x.score) || (y.t - x.t));
          const selected: NewsItem[] = scored.slice(0, this.maxPerSymbol).map(({ a }) => ({
            symbol: sym,
            time: a.publishedAt || new Date().toISOString(),
            source: a?.source?.name || undefined,
            title: String(a?.title || '').slice(0, 300),
            url: a?.url || '',
          }));
          out[sym] = selected;
          this.cache.set(cacheKey, { data: selected, expires: now + this.cacheTtlMs });

          // Write-through: сохраняем в БД (идемпотентно по URL) и индексируем по символу
          try {
            await Promise.all(selected.map((it) => newsRepo.upsertArticleWithIndex(sym, {
              provider: 'newsapi',
              title: it.title,
              url: it.url,
              source: it.source || null,
              publishedAt: new Date(it.time),
              language: this.language,
              symbols: [sym],
              countries: null as any,
              topics: null as any,
              sentiment: null,
            })));
          } catch (persistErr) {
            logger.warn('NewsService write-through persist failed (non-fatal)', { symbol: sym, error: String(persistErr) });
          }
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
