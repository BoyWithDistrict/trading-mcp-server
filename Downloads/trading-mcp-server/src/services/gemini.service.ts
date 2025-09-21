import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config';
import logger from '../utils/logger';
import { validateAiResult, AiAnalysisJSON } from '../utils/ai-schema';
import { ProxyAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from 'undici';
import { SocksProxyAgent } from 'socks-proxy-agent';

class GeminiService {
  private genAI: GoogleGenerativeAI;
  private model: any;
  private modelName?: string;
  private proxyDispatcher?: Dispatcher;

  constructor() {
    const apiKey = config.api.gemini.apiKey;
    if (!apiKey) {
      logger.warn('GEMINI_API_KEY is not set. Some features may be limited.');
      return;
    }

    try {
      // Если задан прокси для Gemini — создаём агент (http/https или socks), но не устанавливаем глобально
      const proxyUrl = config.api.gemini.proxyUrl || '';
      if (proxyUrl) {
        try {
          if (/^socks/i.test(proxyUrl)) {
            this.proxyDispatcher = new SocksProxyAgent(proxyUrl) as unknown as Dispatcher;
            logger.info('Gemini: SocksProxyAgent initialized (per-call)');
          } else {
            this.proxyDispatcher = new ProxyAgent(proxyUrl);
            logger.info('Gemini: ProxyAgent initialized (per-call)');
          }
        } catch (e) {
          logger.warn('Gemini: failed to init ProxyAgent, proceeding without proxy', { error: String(e) });
        }
      }

      this.genAI = new GoogleGenerativeAI(apiKey);
      this.modelName = config.api.gemini.model || 'gemini-1.5-flash';
      this.model = this.genAI.getGenerativeModel({ model: this.modelName });
      logger.info(`Gemini service initialized successfully with model: ${this.modelName}`);
    } catch (error) {
      logger.error('Failed to initialize Gemini service', { error: String((error as any)?.message || error) });
      throw error;
    }
  }

  /**
   * Анализирует текст с помощью Gemini API
   * @param prompt Текст для анализа
   * @returns Результат анализа
   */
  public async analyzeText(prompt: string, lang: 'ru' | 'en' = 'ru'): Promise<string> {
    if (!this.model) {
      throw new Error('Gemini service is not properly initialized');
    }

    try {
      // Временное применение прокси только для этого вызова
      let prev: Dispatcher | null = null;
      if (this.proxyDispatcher) {
        try {
          prev = getGlobalDispatcher();
          setGlobalDispatcher(this.proxyDispatcher);
        } catch {}
      }
      try {
        const timeoutMs = config.api.gemini.timeoutMs || 20000;
        const timeoutPromise = new Promise<never>((_, reject) => {
          const t = setTimeout(() => {
            clearTimeout(t);
            reject(new Error(`gemini_timeout_${timeoutMs}ms`));
          }, timeoutMs);
        });
        const work = (async () => {
          const langHint = lang === 'ru'
            ? 'Отвечай на русском языке.'
            : 'Respond in English.';
          const composed = `${prompt}\n\n${langHint}`;
          const result = await this.model.generateContent(composed);
          const response = await result.response;
          return response.text();
        })();
        return await Promise.race([work, timeoutPromise]);
      } finally {
        if (this.proxyDispatcher && prev) {
          try { setGlobalDispatcher(prev); } catch {}
        }
      }
    } catch (error) {
      const msg = String((error as any)?.message || (error as any));
      logger.error('Error analyzing text with Gemini', { error: msg });
      // Попробуем fallback-модель при типичных ошибках валидации/совместимости
      const fallback = config.api.gemini.fallbackModel;
      if (fallback && this.modelName !== fallback) {
        try {
          logger.warn(`Retrying with fallback Gemini model: ${fallback}`);
          let prev: Dispatcher | null = null;
          if (this.proxyDispatcher) {
            try { prev = getGlobalDispatcher(); setGlobalDispatcher(this.proxyDispatcher); } catch {}
          }
          try {
            const timeoutMs = config.api.gemini.timeoutMs || 20000;
            const timeoutPromise = new Promise<never>((_, reject) => {
              const t = setTimeout(() => {
                clearTimeout(t);
                reject(new Error(`gemini_timeout_${timeoutMs}ms`));
              }, timeoutMs);
            });
            const altModel = this.genAI.getGenerativeModel({ model: fallback });
            const work = (async () => {
              const langHint = lang === 'ru' ? 'Отвечай на русском языке.' : 'Respond in English.';
              const composed = `${prompt}\n\n${langHint}`;
              const alt = await altModel.generateContent(composed);
              const altResp = await alt.response;
              return altResp.text();
            })();
            return await Promise.race([work, timeoutPromise]);
          } finally {
            if (this.proxyDispatcher && prev) { try { setGlobalDispatcher(prev); } catch {} }
          }
        } catch (e2) {
          logger.error('Fallback Gemini model also failed', { error: String((e2 as any)?.message || e2) });
        }
      }
      throw new Error('Failed to analyze text with Gemini');
    }
  }

  /**
   * Анализирует торговые данные
   * @param trades Массив сделок
   * @param marketConditions Рыночные условия
   * @returns Анализ торговых данных
   */
  public async analyzeTradingData(trades: any[], marketConditions: any): Promise<string> {
    const prompt = this.buildTradingAnalysisPrompt(trades, marketConditions);
    return this.analyzeText(prompt);
  }

  /**
   * Анализирует торговые данные и возвращает строго JSON-структуру, если возможно
   */
  public async analyzeTradingDataJSON(
    trades: any[],
    marketConditions: any,
    lang: 'ru' | 'en' = 'ru'
  ): Promise<{ ai?: AiAnalysisJSON; rawText?: string; error?: string; meta?: { model?: string; latencyMs?: number; promptChars?: number; responseChars?: number } }> {
    if (!this.model) {
      throw new Error('Gemini service is not properly initialized');
    }

    const prompt = this.buildTradingAnalysisJSONPrompt(trades, marketConditions, lang);
    const tryOnce = async (p: string, modelInstance: any, modelName: string) => {
      const started = Date.now();
      let prev: Dispatcher | null = null;
      if (this.proxyDispatcher) {
        try { prev = getGlobalDispatcher(); setGlobalDispatcher(this.proxyDispatcher); } catch {}
      }
      try {
        const timeoutMs = config.api.gemini.timeoutMs || 20000;
        const timeoutPromise = new Promise<never>((_, reject) => {
          const t = setTimeout(() => {
            clearTimeout(t);
            reject(new Error(`gemini_timeout_${timeoutMs}ms`));
          }, timeoutMs);
        });
        const work = (async () => {
          const result = await modelInstance.generateContent(p);
          const response = await result.response;
          return response.text();
        })();
        const text = await Promise.race([work, timeoutPromise]);
        const latencyMs = Date.now() - started;
        return { text, latencyMs, modelName, promptChars: p.length, responseChars: text?.length || 0 };
      } finally {
        if (this.proxyDispatcher && prev) { try { setGlobalDispatcher(prev); } catch {} }
      }
    };

    try {
      // Первая попытка
      let first = await tryOnce(prompt, this.model, this.modelName || '');
      let text = first.text;
      let ai: AiAnalysisJSON | undefined;
      try {
        const parsed = JSON.parse(text);
        const v = validateAiResult(parsed);
        if (v.ok) ai = parsed as AiAnalysisJSON;
        else throw new Error(v.reason);
      } catch (e1) {
        // Репромпт с уточнением — вернуть строго JSON без преамбул
        logger.warn('AI JSON parse failed, retrying with stricter instruction', { reason: String((e1 as any)?.message || e1) });
        const strictPrompt = `${prompt}\n\nВАЖНО: Верни ТОЛЬКО корректный JSON без пояснений и форматирования Markdown.`;
        const second = await tryOnce(strictPrompt, this.model, this.modelName || '');
        text = second.text;
        try {
          const parsed2 = JSON.parse(text);
          const v2 = validateAiResult(parsed2);
          if (v2.ok) ai = parsed2 as AiAnalysisJSON;
          else throw new Error(v2.reason);
        } catch (e2) {
          // Возвращаем сырой текст как fallback
          return { rawText: text, error: String((e2 as any)?.message || e2), meta: { model: this.modelName, latencyMs: first.latencyMs, promptChars: strictPrompt.length, responseChars: text?.length || 0 } };
        }
      }

      return { ai, meta: { model: this.modelName, latencyMs: first.latencyMs, promptChars: prompt.length, responseChars: text?.length || 0 } };
    } catch (error) {
      const msg = String((error as any)?.message || error);
      logger.error('Error analyzing trading data (JSON) with Gemini', { error: msg });
      // Попробуем fallback-модель
      const fallback = config.api.gemini.fallbackModel;
      if (fallback && this.modelName !== fallback) {
        try {
          logger.warn(`Retrying JSON analysis with fallback Gemini model: ${fallback}`);
          const altModel = this.genAI.getGenerativeModel({ model: fallback });
          const p = this.buildTradingAnalysisJSONPrompt(trades, marketConditions, lang);
          const altResult = await (async () => {
            const started = Date.now();
            let prev: Dispatcher | null = null;
            if (this.proxyDispatcher) {
              try { prev = getGlobalDispatcher(); setGlobalDispatcher(this.proxyDispatcher); } catch {}
            }
            try {
              const timeoutMs = config.api.gemini.timeoutMs || 20000;
              const timeoutPromise = new Promise<never>((_, reject) => {
                const t = setTimeout(() => {
                  clearTimeout(t);
                  reject(new Error(`gemini_timeout_${timeoutMs}ms`));
                }, timeoutMs);
              });
              const work = (async () => {
                const r = await altModel.generateContent(p);
                const resp = await r.response;
                return resp.text();
              })();
              const text = await Promise.race([work, timeoutPromise]);
              return { text, latencyMs: Date.now() - started, modelName: fallback, promptChars: p.length, responseChars: text?.length || 0 };
            } finally {
              if (this.proxyDispatcher && prev) { try { setGlobalDispatcher(prev); } catch {} }
            }
          })();
          const text = altResult.text;
          try {
            const parsed = JSON.parse(text);
            const v = validateAiResult(parsed);
            if (v.ok) return { ai: parsed as AiAnalysisJSON, meta: { model: fallback, latencyMs: altResult.latencyMs, promptChars: altResult.promptChars, responseChars: altResult.responseChars } };
          } catch {}
          return { rawText: text, error: 'invalid_json', meta: { model: fallback, latencyMs: altResult.latencyMs, promptChars: altResult.promptChars, responseChars: altResult.responseChars } };
        } catch (e2) {
          logger.error('Fallback Gemini model (JSON) also failed', { error: String((e2 as any)?.message || e2) });
        }
      }
      return { error: 'json_analysis_failed' };
    }
  }

  private buildTradingAnalysisPrompt(trades: any[], marketConditions: any): string {
    // Строим компактное резюме по рынку, чтобы не превышать лимиты модели
    const period = marketConditions?.from && marketConditions?.to && marketConditions?.timespan
      ? { from: marketConditions.from, to: marketConditions.to, timespan: marketConditions.timespan }
      : undefined;

    const candles = marketConditions?.candles || {};
    const marketIndicators = marketConditions?.marketIndicators || {};
    const news = marketConditions?.news || {};
    const symbolSummaries: Record<string, any> = {};
    try {
      for (const [sym, arr] of Object.entries<any>(candles)) {
        const items = Array.isArray(arr) ? arr : [];
        if (!items.length) {
          symbolSummaries[sym] = { count: 0 };
          continue;
        }
        const closes = items.map((c: any) => Number(c?.c)).filter((v: any) => Number.isFinite(v));
        const highs = items.map((c: any) => Number(c?.h)).filter((v: any) => Number.isFinite(v));
        const lows = items.map((c: any) => Number(c?.l)).filter((v: any) => Number.isFinite(v));
        const first = closes[0];
        const last = closes[closes.length - 1];
        const min = Math.min(...lows);
        const max = Math.max(...highs);
        const avg = closes.reduce((a: number, b: number) => a + b, 0) / Math.max(1, closes.length);
        symbolSummaries[sym] = {
          count: items.length,
          firstClose: first,
          lastClose: last,
          minLow: min,
          maxHigh: max,
          avgClose: Number.isFinite(avg) ? Number(avg.toFixed(6)) : undefined,
        };
      }
    } catch {}

    // Оставляем сделки как есть, но это обычно короткий список
    const safeTrades = Array.isArray(trades) ? trades.slice(0, 100) : [];

    const payload = {
      trades: safeTrades,
      period,
      marketSummary: symbolSummaries,
      marketIndicators,
      news,
    };

    return `Ты — опытный трейдинг-аналитик. На основе данных ниже дай структурированный, практичный и краткий анализ.
Данные (JSON):\n${JSON.stringify(payload, null, 2)}

Проанализируй:
1) Общую эффективность торгов (на уровне метрик и кратких пояснений)
2) Сильные и слабые стороны стратегии
3) Конкретные рекомендации по улучшению (риски/менеджмент позиции/тайминг)
4) Оценку рисков на рассматриваемом периоде и по инструментам

Формат ответа: несколько абзацев и маркированные пункты, избегай воды, опирайся на числа из данных.`;
  }

  private buildTradingAnalysisJSONPrompt(trades: any[], marketConditions: any): string {
    const period = marketConditions?.from && marketConditions?.to && marketConditions?.timespan
      ? { from: marketConditions.from, to: marketConditions.to, timespan: marketConditions.timespan }
      : undefined;

    const candles = marketConditions?.candles || {};
    const symbolSummaries: Record<string, any> = {};
    try {
      for (const [sym, arr] of Object.entries<any>(candles)) {
        const items = Array.isArray(arr) ? arr : [];
        if (!items.length) {
          symbolSummaries[sym] = { count: 0 };
          continue;
        }
        const closes = items.map((c: any) => Number(c?.c)).filter((v: any) => Number.isFinite(v));
        const highs = items.map((c: any) => Number(c?.h)).filter((v: any) => Number.isFinite(v));
        const lows = items.map((c: any) => Number(c?.l)).filter((v: any) => Number.isFinite(v));
        const first = closes[0];
        const last = closes[closes.length - 1];
        const min = Math.min(...lows);
        const max = Math.max(...highs);
        const avg = closes.reduce((a: number, b: number) => a + b, 0) / Math.max(1, closes.length);
        symbolSummaries[sym] = {
          count: items.length,
          firstClose: first,
          lastClose: last,
          minLow: min,
          maxHigh: max,
          avgClose: Number.isFinite(avg) ? Number(avg.toFixed(6)) : undefined,
        };
      }
    } catch {}

    const safeTrades = Array.isArray(trades) ? trades.slice(0, 100) : [];
    const payload = {
      trades: safeTrades,
      period,
      marketSummary: symbolSummaries,
    };

    return `Ты — опытный трейдинг-аналитик. На основе данных ниже (с агрегатами индикаторов и дайджестом новостей по инструментам) верни СТРОГО корректный JSON без каких-либо пояснений, без Markdown и без префиксов/суффиксов.
Данные (JSON):\n${JSON.stringify(payload, null, 2)}

Структура ответа:
{
  "summary": string,
  "strengths": string[],
  "weaknesses": string[],
  "recommendations": string[],
  "riskAssessment"?: {
    "period"?: string,
    "instruments"?: Record<string,string>,
    "keyRisks"?: string[]
  },
  "assumptions"?: string[]
}

Требования:
- Верни ТОЛЬКО JSON-объект (не массив, не текст), без дополнительных комментариев, без кода и без форматирования Markdown.
- Опирайся на числа из данных и кратко формулируй пункты.
- Учитывай влияние новостей на волатильность/направление и возможные ошибки стратегии возле событий.`;
  }
}

// Экспортируем синглтон
export default new GeminiService();


