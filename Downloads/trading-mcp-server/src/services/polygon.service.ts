import config from '../config';
import logger from '../utils/logger';
import { MarketCandle, Timespan } from '../types/market';
import { mapToPolygonForexTicker } from '../utils/symbol-mapper';
import { ProxyAgent } from 'undici';
import { ErrorHandler } from '../utils/error-handler';
import Redis from 'ioredis';

interface PolygonAggsResponse {
  results?: Array<{
    t: number;
    o: number;
    h: number;
    l: number;
    c: number;
    v?: number;
  }>;
  resultsCount?: number;
  queryCount?: number;
  status?: string;
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function toUtcDate(dateLike: string | number | Date): Date {
  if (dateLike instanceof Date) return new Date(dateLike.getTime());
  if (typeof dateLike === 'number') return new Date(dateLike);
  return new Date(dateLike);
}

function formatYyyyMmDdUTC(dateLike: string | number | Date): string {
  const d = toUtcDate(dateLike);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function epochMs(dateLike: string | number | Date): number {
  return toUtcDate(dateLike).getTime();
}

export class PolygonService {
  private apiKey: string;
  private timeoutMs: number;
  private maxRetries: number;
  private backoffBaseMs: number;
  private cacheTtlMs: number;
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private proxyAgent?: ProxyAgent;
  private redis?: Redis;

  constructor() {
    this.apiKey = config.api.polygon.apiKey;
    this.timeoutMs = config.api.polygon.defaults.requestTimeoutMs;
    this.maxRetries = config.api.polygon.defaults.maxRetries;
    this.backoffBaseMs = config.api.polygon.defaults.backoffBaseMs;
    this.cacheTtlMs = config.api.polygon.defaults.cacheTtlMs;

    if (!this.apiKey) {
      logger.warn('POLYGON_API_KEY is not set. PolygonService will not function properly.');
    }

    // Используем отдельный прокси для Polygon, если задан в конфиге, и не трогаем системные прокси
    // Учтём NO_PROXY: если указан api.polygon.io в NO_PROXY, игнорируем прокси
    const noProxy = (process.env.NO_PROXY || process.env.no_proxy || '').toLowerCase();
    const hostInNoProxy = noProxy.split(',').map((s) => s.trim()).filter(Boolean).some((h) => h === 'api.polygon.io');
    const proxyUrl = !hostInNoProxy ? (config.api.polygon as any).proxyUrl : '';
    if (proxyUrl) {
      try {
        this.proxyAgent = new ProxyAgent(proxyUrl);
        logger.info('HTTP proxy detected. Using ProxyAgent for outgoing requests');
      } catch (e) {
        logger.warn('Failed to initialize ProxyAgent. Proceeding without proxy.', { error: String(e) });
      }
    }

    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, { lazyConnect: true });
        this.redis.on('error', (e) => {
          logger.warn('Redis connection error (PolygonService). Fallback to in-memory cache', { error: String(e) });
        });
        // Попытка подключения отложенно
        this.redis.connect().catch((e) => {
          logger.warn('Redis connect failed (PolygonService). Continuing without Redis', { error: String(e) });
        });
      } catch (e) {
        logger.warn('Failed to initialize Redis client (PolygonService). Proceeding without Redis.', { error: String(e) });
      }
    }
  }

  private cacheKey(prefix: string, params: Record<string, any>) {
    return `${prefix}:${Object.entries(params)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([k, v]) => `${k}=${v}`)
      .join('&')}`;
  }

  private getFromCache<T>(key: string): T | null {
    const hit = this.cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      this.cache.delete(key);
      return null;
    }
    return hit.data as T;
  }

  private setCache<T>(key: string, data: T, ttlMs = this.cacheTtlMs) {
    this.cache.set(key, { data, expires: Date.now() + ttlMs });
  }

  private async getFromCacheAsync<T>(key: string): Promise<T | null> {
    // Сначала пробуем Redis
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) {
          return JSON.parse(raw) as T;
        }
      } catch (e) {
        logger.warn('Redis get failed (PolygonService). Falling back to memory', { error: String(e) });
      }
    }
    // Fallback: in-memory
    return this.getFromCache<T>(key);
  }

  private async setCacheAsync<T>(key: string, data: T, ttlMs = this.cacheTtlMs): Promise<void> {
    // Пишем в Redis, если доступен
    if (this.redis) {
      try {
        await this.redis.set(key, JSON.stringify(data), 'PX', ttlMs);
      } catch (e) {
        logger.warn('Redis set failed (PolygonService). Writing to memory cache', { error: String(e) });
      }
    }
    // Всегда дублируем в in-memory как быстрый локальный кэш
    this.setCache(key, data, ttlMs);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const r = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        // Если прокси настроен через env, пробрасываем агент
        dispatcher: this.proxyAgent,
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

  private async fetchWithRetry<T>(url: string): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await this.fetchJson<T>(url);
      } catch (err: any) {
        attempt++;
        const msg = String(err?.message || err);
        const timeout = /UND_ERR_CONNECT_TIMEOUT|aborted|network timeout|ETIMEDOUT/i.test(msg);
        const transient = /fetch failed|ECONNRESET|EAI_AGAIN|ENOTFOUND|ETIMEDOUT/i.test(msg);
        const m = msg.match(/HTTP (\d{3})/);
        const status = m ? parseInt(m[1], 10) : undefined;

        // Решаем, ретраить или нет
        const retryableByStatus = status === 429 || (status !== undefined && status >= 500);
        const isRetryable = timeout || transient || retryableByStatus;

        if (!isRetryable) {
          // Неретраябельная ошибка: отдаём понятный статус (если есть)
          const code = status ?? 502;
          logger.error('Polygon request failed (non-retryable)', { url, attempt, error: msg, status: code });
          throw new ErrorHandler(msg, code);
        }

        if (attempt > this.maxRetries) {
          // Превышен лимит ретраев — маппим таймауты на 504, прочие на статус или 502
          const code = timeout ? 504 : status ?? 502;
          logger.error('Polygon request failed (max retries exceeded)', { url, attempt, error: msg, status: code });
          throw new ErrorHandler(timeout ? 'Polygon connectivity timeout' : msg, code);
        }

        const delay = this.backoffBaseMs * Math.pow(2, attempt - 1);
        logger.warn(`Retrying Polygon request (attempt ${attempt}) after ${delay}ms`, { url, status, timeout });
        await sleep(delay);
      }
    }
  }

  // timespan mapping: our 'hour' -> Polygon 'hour', 'day' -> 'day', 'minute' -> 'minute'
  public async getForexAggregates(
    journalSymbol: string,
    fromIso: string,
    toIso: string,
    timespan: Timespan
  ): Promise<MarketCandle[]> {
    const polyTicker = mapToPolygonForexTicker(journalSymbol, config.api.polygon.defaults.forexPrefix);

    const multiplier = 1;
    const adjusted = 'true'; // forex often 24/7
    const sort = 'asc';

    const params = {
      ticker: polyTicker,
      from: fromIso,
      to: toIso,
      multiplier,
      timespan,
      adjusted,
      sort,
    } as const;

    const key = this.cacheKey('aggs', params as any);
    const cached = await this.getFromCacheAsync<MarketCandle[]>(key);
    if (cached) return cached;

    const searchParams = new URLSearchParams({
      adjusted,
      sort,
      limit: '50000',
      apiKey: this.apiKey,
    });

    const base = 'https://api.polygon.io/v2/aggs/ticker';
    // Нормализация from/to в зависимости от timespan
    const fromParam = timespan === 'day' ? formatYyyyMmDdUTC(fromIso) : String(epochMs(fromIso));
    const toParam = timespan === 'day' ? formatYyyyMmDdUTC(toIso) : String(epochMs(toIso));
    const url = `${base}/${encodeURIComponent(polyTicker)}/range/${multiplier}/${timespan}/${encodeURIComponent(
      fromParam
    )}/${encodeURIComponent(toParam)}?${searchParams.toString()}`;

    const candles: MarketCandle[] = [];
    let pageUrl: string | undefined = url;
    let pages = 0;
    const MAX_PAGES = 50; // предохранитель от бесконечной пагинации

    while (pageUrl && pages < MAX_PAGES) {
      const json = await this.fetchWithRetry<PolygonAggsResponse>(pageUrl);
      const chunk: MarketCandle[] = (json.results || []).map((r) => ({
        t: r.t,
        o: r.o,
        h: r.h,
        l: r.l,
        c: r.c,
        v: r.v,
      }));
      candles.push(...chunk);

      // Переходим к следующей странице, если есть
      const next = (json as any).next_url as string | undefined;
      if (next) {
        // Убеждаемся, что apiKey присутствует
        const hasApiKey = /[?&]apiKey=/.test(next);
        pageUrl = hasApiKey ? next : `${next}${next.includes('?') ? '&' : '?'}apiKey=${this.apiKey}`;
        pages++;
      } else {
        pageUrl = undefined;
      }
    }

    // TTL по timespan
    let ttl = this.cacheTtlMs;
    try {
      if (timespan === 'minute') ttl = config.api.polygon.defaults.ttlByTimespanMinuteMs;
      else if (timespan === 'hour') ttl = config.api.polygon.defaults.ttlByTimespanHourMs;
      else if (timespan === 'day') ttl = config.api.polygon.defaults.ttlByTimespanDayMs;
    } catch {}
    await this.setCacheAsync(key, candles, ttl);
    return candles;
  }
}

export default new PolygonService();
