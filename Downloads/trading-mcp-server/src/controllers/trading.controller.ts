import { Request, Response } from 'express';
import { BaseController } from './base.controller';
import polygonService from '../services/polygon.service';
import geminiService from '../services/gemini.service';
import { AnalysisRequestBody, Timespan } from '../types/market';
import { normalizeJournalSymbol } from '../utils/symbol-mapper';
import prisma from '../services/prisma';
import { getOrCreateDemoUserId } from '../services/user.service';
import { summarizeIndicators, getIndicatorsSnapshot } from '../utils/indicators';
import { coerceTextToV2 } from '../utils/ai-postprocess';
import newsService from '../services/news.service';
import { getPersonalizationWeights, makePhraseNormalizer, truncateContext } from '../config/personalization';
import logger from '../utils/logger';
import { persistMacroData, loadMacroDataFromDb, hasAnyData } from '../services/macro-cache.service';
import fredService from '../services/fred.service';

const MAX_RANGE_DAYS: Record<Timespan, number> = {
  minute: 7,
  hour: 30,
  day: 365,
};

function diffDaysUTC(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (isNaN(from) || isNaN(to)) return NaN;
  return Math.max(0, Math.ceil((to - from) / (24 * 60 * 60 * 1000)));
}

// Простой контроллер для работы с торговыми данными
export class TradingController extends BaseController {
  // Получение списка сделок
  public getTrades = this.asyncHandler(async (req: Request, res: Response) => {
    const { date, symbol } = req.query;
    
    // Заглушка с тестовыми данными
    const trades = [
      { id: 1, symbol: 'BTC/USD', type: 'buy', price: 50000, amount: 0.1, timestamp: new Date().toISOString() },
      { id: 2, symbol: 'ETH/USD', type: 'sell', price: 3000, amount: 1, timestamp: new Date().toISOString() }
    ];
    
    // Фильтрация по символу, если указан
    const filteredTrades = symbol 
      ? trades.filter(trade => trade.symbol === symbol)
      : trades;
    
    return this.handleSuccess(res, { trades: filteredTrades });
  });

  // Добавление новой сделки
  public addTrade = this.asyncHandler(async (req: Request, res: Response) => {
    const { symbol, type, price, amount } = req.body;
    
    if (!symbol || !type || !price || !amount) {
      return this.handleError(res, 'Missing required fields', 400);
    }
    
    // В реальном приложении здесь была бы вставка в БД
    const newTrade = {
      id: Date.now(),
      symbol,
      type,
      price: parseFloat(price),
      amount: parseFloat(amount),
      timestamp: new Date().toISOString()
    };
    
    return this.handleSuccess(res, newTrade, 'Trade added successfully', 201);
  });

  // Получение рыночных данных
  public getMarketData = this.asyncHandler(async (req: Request, res: Response) => {
    const { symbol } = req.query;
    
    if (!symbol) {
      return this.handleError(res, 'Symbol is required', 400);
    }
    
    // Заглушка с тестовыми данными
    const marketData = {
      symbol,
      price: Math.random() * 1000 + 40000, // Случайная цена
      change24h: (Math.random() * 10 - 5).toFixed(2),
      volume: (Math.random() * 1000).toFixed(2),
      timestamp: new Date().toISOString()
    };
    
    return this.handleSuccess(res, marketData);
  });

  // Получение статистики портфеля
  public getPortfolioStats = this.asyncHandler(async (req: Request, res: Response) => {
    // Заглушка с тестовыми данными
    const stats = {
      totalValue: 10000,
      dailyChange: 250.50,
      dailyChangePercent: 2.5,
      positions: [
        { symbol: 'BTC', amount: 0.5, value: 25000 },
        { symbol: 'ETH', amount: 10, value: 30000 },
        { symbol: 'SOL', amount: 100, value: 5000 }
      ],
      timestamp: new Date().toISOString()
    };
    
    return this.handleSuccess(res, stats);
  });

  // Получение OHLC (агрегатов) с Polygon для форекс символа
  public getMarketOHLC = this.asyncHandler(async (req: Request, res: Response) => {
    const symbol = String(req.query.symbol || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const timespan = (String(req.query.timespan || 'day').trim() as Timespan);

    if (!symbol || !from || !to) {
      return this.handleError(res, 'Parameters required: symbol, from, to', 400);
    }

    if (!['minute', 'hour', 'day'].includes(timespan)) {
      return this.handleError(res, 'Invalid timespan. Allowed: minute | hour | day', 400);
    }

    const days = diffDaysUTC(from, to);
    if (isNaN(days)) {
      return this.handleError(res, 'Invalid date range', 400);
    }
    if (days > MAX_RANGE_DAYS[timespan]) {
      return this.handleError(
        res,
        `Date range too large for timespan='${timespan}'. Max ${MAX_RANGE_DAYS[timespan]} days`,
        400
      );
    }

    const candles = await polygonService.getForexAggregates(symbol, from, to, timespan);
    return this.handleSuccess(res, { symbol: normalizeJournalSymbol(symbol), timespan, from, to, candles });
  });

  // Анализ периода: получает сделки/символы и подтягивает OHLC, затем вызывает Gemini
  public analyzePeriod = this.asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as AnalysisRequestBody;
    const timespan: Timespan = (body.timespan || 'day');

    // Собираем набор символов
    const symbolSet = new Set<string>();
    (body.symbols || []).forEach((s) => s && symbolSet.add(s));
    (body.trades || []).forEach((t) => t.symbol && symbolSet.add(t.symbol));

    if (symbolSet.size === 0) {
      return this.handleError(res, 'No symbols provided (from trades or symbols)', 400);
    }

    const from = body.from;
    const to = body.to;
    if (!from || !to) {
      return this.handleError(res, 'Parameters required: from, to', 400);
    }

    const days = diffDaysUTC(from, to);
    if (isNaN(days)) {
      return this.handleError(res, 'Invalid date range', 400);
    }
    if (days > MAX_RANGE_DAYS[timespan]) {
      return this.handleError(
        res,
        `Date range too large for timespan='${timespan}'. Max ${MAX_RANGE_DAYS[timespan]} days`,
        400
      );
    }

    // Тянем свечи по каждому символу с ограничением параллелизма и считаем индикаторы
    const symbols = Array.from(symbolSet);
    const candlesBySymbol: Record<string, any> = {};
    const indicatorsBySymbol: Record<string, any> = {};

    const CONCURRENCY = 5; // можно вынести в конфиг при необходимости
    let idx = 0;
    const runWorker = async () => {
      while (true) {
        const i = idx++;
        if (i >= symbols.length) break;
        const s = symbols[i];
        const norm = normalizeJournalSymbol(s);
        const candles = await polygonService.getForexAggregates(s, from, to, timespan);
        candlesBySymbol[norm] = candles;
        try {
          indicatorsBySymbol[norm] = summarizeIndicators(candles);
        } catch {}
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, () => runWorker());
    await Promise.all(workers);

    // Обогащаем сделки индикаторами на момент entry/exit (нужно далее для привязки макро/новостей к сделкам)
    const trades = Array.isArray(body.trades) ? body.trades : [];
    const enrichedTrades = trades.map((t: any) => {
      try {
        const sym = t?.symbol ? normalizeJournalSymbol(String(t.symbol)) : undefined;
        const candles = sym ? candlesBySymbol[sym] : undefined;
        if (candles && candles.length) {
          const entryTime = t?.entryTime || t?.timestamp || t?.time;
          const exitTime = t?.exitTime;
          const snapshot = getIndicatorsSnapshot(candles, entryTime, exitTime);
          return { ...t, indicators: snapshot };
        }
      } catch {}
      return { ...t };
    });

    // Получаем новости по списку символов (если ключ задан)
    let news: Record<string, any[]> | undefined = undefined;
    try {
      const normSymbols = symbols.map(normalizeJournalSymbol);
      const digest = await newsService.getNewsDigest(normSymbols, from, to);
      news = digest;
    } catch {}

    // Макро: экономический календарь (high/medium) и ключевые метрики за период
    // Примечание: макросерии (CPI/UNRATE/FEDFUNDS/GDP) публикуются ежемесячно/ежеквартально.
    // Чтобы не получать пустые ряды при коротком периоде, расширяем окно запроса для макроданных.
    let macroEventsAll: Array<{ time: string; country?: string; event: string; actual?: any; forecast?: any; previous?: any; impact?: string; }> = [];
    let macroData: any = {};
    // Economic calendar: Finnhub отключен. Пока оставляем пустым (MVP).
    try {
      // Read-through: сначала пробуем прочитать из БД на расширенном окне
      const country = 'US';
      const desiredKeys = ['cpi', 'gdp', 'policyRate', 'unemployment', 'pmi'] as const;
      const fromD = new Date(from);
      const toD = new Date(to);
      const extendedFrom = new Date(fromD.getTime() - 400 * 24 * 60 * 60 * 1000).toISOString(); // ~13 месяцев назад
      const extendedTo = toD.toISOString();
      const dbMacro = await loadMacroDataFromDb(country, extendedFrom, extendedTo, desiredKeys as any);
      if (hasAnyData(dbMacro as any)) {
        macroData = { US: dbMacro };
      } else {
        // Fallback: вызываем FRED (US) на расширенном окне и сохраняем в БД
        try { logger.info('AnalyzePeriod: calling FRED.getMacroDataUS', { from: extendedFrom, to: extendedTo }); } catch {}
        const fetched = await fredService.getMacroDataUS(extendedFrom, extendedTo);
        try {
          const sizes = Object.fromEntries(Object.entries(fetched || {}).map(([k,v]: any) => [k, Array.isArray(v?.series) ? v.series.length : 0]));
          logger.info('AnalyzePeriod: FRED.getMacroDataUS returned', { sizes });
        } catch {}
        try { await persistMacroData(fetched as any); } catch (e) { logger.warn('persistMacroData failed (non-fatal)', { error: String(e) }); }
        macroData = { US: fetched };
      }
    } catch {}

    // Группировка macroEvents по дате и привязка к сделкам
    const macroEventsByDate: Record<string, any[]> = {};
    try {
      for (const ev of macroEventsAll) {
        const d = new Date(ev.time);
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        if (!macroEventsByDate[key]) macroEventsByDate[key] = [];
        macroEventsByDate[key].push(ev);
      }
    } catch {}

    const macroEventsByTrade: Record<string, any[]> = {};
    const newsByTrade: Record<string, any[]> = {};
    try {
      const dayMs = 24 * 60 * 60 * 1000;
      const aggregatedNews = news || {};
      for (const t of enrichedTrades) {
        const id = (t && t.id != null) ? String(t.id) : undefined;
        if (!id) continue;
        const entryMs = t?.entryTime ? new Date(t.entryTime).getTime() : (t?.timestamp ? new Date(t.timestamp).getTime() : NaN);
        const exitMs = t?.exitTime ? new Date(t.exitTime).getTime() : entryMs;
        if (!isFinite(entryMs)) continue;
        const fromMs = entryMs - dayMs;
        const toMs = (isFinite(exitMs) ? exitMs : entryMs) + dayMs;
        // macro events filter
        macroEventsByTrade[id] = (macroEventsAll || []).filter((ev) => {
          const ts = new Date(ev.time).getTime();
          return ts >= fromMs && ts <= toMs;
        });
        // news filter by time window across all related symbols for the trade
        const sym = t?.symbol ? normalizeJournalSymbol(String(t.symbol)) : undefined;
        const newsLists: any[] = [];
        if (sym && aggregatedNews[sym]) newsLists.push(...aggregatedNews[sym]);
        // Также попробуем новости по всем символам периода, если нужно расширить охват
        // const allLists = Object.values(aggregatedNews) as any[];
        newsByTrade[id] = newsLists.filter((n: any) => {
          const ts = new Date(n.time).getTime();
          return isFinite(ts) && ts >= fromMs && ts <= toMs;
        });

      }
    } catch {}

    // enrichedTrades уже рассчитаны выше

    // Подготовим компактный макро-контекст: урезанные ряды и сводку
    let macroDataTrimmed: any = undefined;
    let macroSummary: any = undefined;
    try {
      const promptPoints = Math.max(1, Number(process.env.MACRO_PROMPT_POINTS || 3));
      const trimSeries = (s?: { series?: any[]; meta?: any }) => {
        if (!s || !Array.isArray(s.series)) return s;
        const n = s.series.length;
        const cut = s.series.slice(Math.max(0, n - promptPoints));
        return { ...s, series: cut };
      };
      const latestOf = (s?: { series?: Array<{ time: string; value: number }> }) => {
        if (!s || !Array.isArray(s.series) || s.series.length === 0) return undefined;
        return s.series[s.series.length - 1];
      };
      const prevOf = (s?: { series?: Array<{ time: string; value: number }> }) => {
        if (!s || !Array.isArray(s.series) || s.series.length < 2) return undefined;
        return s.series[s.series.length - 2];
      };
      const yoyOf = (s?: { series?: Array<{ time: string; value: number }> }) => {
        if (!s || !Array.isArray(s.series) || s.series.length < 13) return undefined;
        const latest = s.series[s.series.length - 1];
        const ago = s.series[s.series.length - 13];
        if (!latest || !ago) return undefined;
        const abs = latest.value - ago.value;
        const pct = ago.value !== 0 ? (abs / ago.value) * 100 : undefined;
        return { abs, pct };
      };

      const usAll = (macroData && macroData.US) ? macroData.US : macroData;
      const usTrim = usAll ? {
        cpi: trimSeries(usAll.cpi),
        gdp: trimSeries(usAll.gdp),
        policyRate: trimSeries(usAll.policyRate),
        unemployment: trimSeries(usAll.unemployment),
        pmi: trimSeries(usAll.pmi),
      } : undefined;
      if (usAll && (usAll.cpi || usAll.unemployment || usAll.policyRate || usAll.gdp)) {
        const cpiLast = latestOf(usAll.cpi);
        const cpiYoY = yoyOf(usAll.cpi);
        const unLast = latestOf(usAll.unemployment);
        const unPrev = prevOf(usAll.unemployment);
        const rateLast = latestOf(usAll.policyRate);
        const ratePrev = prevOf(usAll.policyRate);
        const gdpLast = latestOf(usAll.gdp);
        const gdpPrev = prevOf(usAll.gdp);
        macroSummary = {
          US: {
            cpi: cpiLast ? { date: cpiLast.time, value: cpiLast.value, yoyPct: cpiYoY?.pct } : undefined,
            unemployment: unLast ? { date: unLast.time, value: unLast.value, delta: (unPrev ? unLast.value - unPrev.value : undefined) } : undefined,
            policyRate: rateLast ? { date: rateLast.time, value: rateLast.value, delta: (ratePrev ? rateLast.value - ratePrev.value : undefined) } : undefined,
            gdp: gdpLast ? { date: gdpLast.time, value: gdpLast.value, delta: (gdpPrev ? gdpLast.value - gdpPrev.value : undefined) } : undefined,
          },
        };
      }
      macroDataTrimmed = usTrim ? { US: usTrim } : macroData;
    } catch {}

    // Формируем marketConditions для API ответа: свечи + агрегаты индикаторов + новости + макро
    const marketConditions = {
      timespan,
      from,
      to,
      candles: candlesBySymbol,
      marketIndicators: indicatorsBySymbol,
      news: news ? { aggregated: news, byTrade: newsByTrade } : undefined,
      macroEvents: { all: macroEventsAll, byDate: macroEventsByDate, byTrade: macroEventsByTrade },
      macroData: macroDataTrimmed || macroData,
      macroSummary,
      macroInPrompt: undefined as any,
    };

    // Подготовим marketConditionsForAI: для minute используем только macroSummary (по умолчанию)
    const minuteSummaryOnly = String(process.env.MACRO_MINUTE_USE_SUMMARY_ONLY || 'true').toLowerCase() === 'true';
    const marketConditionsForAI = (() => {
      if (timespan === 'minute' && minuteSummaryOnly) {
        const mc = { ...marketConditions } as any;
        // Уберём макроряды чтобы не засорять контекст ИИ на скальпинге
        mc.macroData = undefined;
        mc.macroInPrompt = 'summary-only';
        return mc;
      }
      const mc = { ...marketConditions } as any;
      mc.macroInPrompt = 'full';
      return mc;
    })();

    // Логирование объёмов макро/новостей для быстрой диагностики
    try {
      const macroAll = Array.isArray(macroEventsAll) ? macroEventsAll.length : 0;
      const macroDataKeys = Object.keys(macroData || {}).filter(k => !!(macroData as any)[k]).length;
      const newsSyms = news ? Object.keys(news).length : 0;
      const newsByTradeCount = Object.keys(newsByTrade || {}).length;
      logger.info('AnalyzePeriod context snapshot', {
        macroEventsAll: macroAll,
        macroDataSeries: macroDataKeys,
        newsSymbols: newsSyms,
        newsByTrade: newsByTradeCount,
      });
    } catch {}

    // Подготовим trades (обогащённые) для промпта
    // Если пришёл ровно один trade с id — сохраним связь в AIAnalysis.tradeId
    let singleTradeId: string | null = null;
    try {
      const ids = (trades || [])
        .map((t: any) => (t && t.id != null ? String(t.id) : null))
        .filter((v: any) => !!v);
      const unique = Array.from(new Set(ids));
      if (unique.length === 1) singleTradeId = unique[0];
    } catch {}

    // Определяем язык ответа ИИ
    const bodyLang = (req.body?.lang || '').toString().toLowerCase();
    const acceptLang = (req.headers['accept-language'] || '').toString().toLowerCase();
    const lang: 'ru' | 'en' = bodyLang === 'en' ? 'en' : bodyLang === 'ru' ? 'ru' : (acceptLang.startsWith('en') ? 'en' : 'ru');

    // Версия схемы ответа AI
    const schema: 'v1' | 'v2' = ((): 'v1' | 'v2' => {
      const s = (req.body?.schema || '').toString().toLowerCase();
      return s === 'v1' ? 'v1' : 'v2';
    })();

    // Персонализация: короткая статистика повторяющихся ошибок за последние N дней (с весами)
    const historyDays = Number(req.body?.historyDays || 14);
    let personalContext: string | undefined = undefined;
    try {
      const userId = await getOrCreateDemoUserId();
      const since = new Date(Date.now() - Math.max(1, historyDays) * 24 * 60 * 60 * 1000);
      const recent = await prisma.aIAnalysis.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { response: true },
        take: 200,
        orderBy: { createdAt: 'desc' },
      });
      // Подготовим веса по текущим символам и направлению сделок
      const W = getPersonalizationWeights();
      const currentSymbols = new Set<string>((body.symbols || []).map((s: string) => normalizeJournalSymbol(String(s))));
      const currentDir = (() => {
        const dirs = (enrichedTrades || []).map((t: any) => String(t?.direction || '').toLowerCase());
        return {
          hasLong: dirs.some((d) => d.includes('buy') || d.includes('long') || d.includes('покуп')),
          hasShort: dirs.some((d) => d.includes('sell') || d.includes('short') || d.includes('продаж')),
        };
      })();

      // Нормализатор синонимов -> канонические кластеры
      const normalizePhrase = makePhraseNormalizer();

      // Общие частоты и частоты по символам
      const freq: Record<string, number> = {};
      const perSymbol: Record<string, Record<string, number>> = {};
      const add = (s: string, weight: number) => {
        const key = normalizePhrase(s);
        if (!key) return;
        freq[key] = (freq[key] || 0) + weight;
      };
      const addPerSymbol = (symbol: string, s: string, weight: number) => {
        const key = normalizePhrase(s);
        if (!key) return;
        if (!perSymbol[symbol]) perSymbol[symbol] = {};
        perSymbol[symbol][key] = (perSymbol[symbol][key] || 0) + weight;
      };

      for (const r of recent) {
        try {
          const obj = JSON.parse(String(r.response || '{}'));
          const ai = obj?.ai || obj;
          const fullText = JSON.stringify(ai || {}).toLowerCase();

          // Валидность V2 повышает базовый вес
          let baseWeight = W.baseOther;
          const isV2 = typeof ai?.summary === 'string' && typeof ai?.marketContext === 'string' && typeof ai?.tradeAnalysis === 'string' && typeof ai?.psychology === 'string';
          if (isV2) baseWeight = W.baseV2;

          // Символьный вес: если среди текущих символов есть упоминание в тексте — умножаем на 1, иначе 0.5
          let symbolWeight = W.symbolOther;
          let matchedSymbols: string[] = [];
          for (const s of currentSymbols) {
            if (s && fullText.includes(s.toLowerCase())) { symbolWeight = W.symbolMatch; matchedSymbols.push(s); }
          }

          // Вес по направлению: если текущий запрос преимущественно long/short и это упомянуто в тексте — усиливаем
          let dirWeight = 1.0;
          if (currentDir.hasLong && /long|buy|покупк/.test(fullText)) dirWeight *= W.dirMatchBoost;
          if (currentDir.hasShort && /short|sell|продаж/.test(fullText)) dirWeight *= W.dirMatchBoost;

          const weight = baseWeight * symbolWeight * dirWeight;

          const weaknesses: string[] = Array.isArray(ai?.weaknesses) ? ai.weaknesses : [];
          const recommendations: string[] = Array.isArray(ai?.recommendations) ? ai.recommendations : [];
          weaknesses.forEach((w) => {
            add(w, weight);
            matchedSymbols.forEach((sym) => addPerSymbol(sym, w, weight));
          });
          // Рекомендации учитываем с понижающим коэффициентом, чтобы не размывать сигнал
          const recW = weight * W.recFactor;
          recommendations.forEach((s) => {
            add(`[rec] ${s}`, recW);
            matchedSymbols.forEach((sym) => addPerSymbol(sym, `[rec] ${s}`, recW));
          });
        } catch {}
      }

      // Формируем многострочный personalContext: топ по символам + общий итог
      const lines: string[] = [];
      const symbolList = Array.from(currentSymbols);
      const maxSym = W.maxSymbolsInContext;
      for (const sym of symbolList.slice(0, maxSym)) {
        const dict = perSymbol[sym];
        if (!dict) continue;
        const top = Object.entries(dict).sort((a, b) => b[1] - a[1]).slice(0, W.topPatternsPerSymbol);
        if (!top.length) continue;
        lines.push(`${sym}: ${top.map(([k, v]) => `${k} — ${v.toFixed(1)}`).join('; ')}`);
      }
      const overallTop = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (overallTop.length) lines.push(`Итого: ${overallTop.map(([k, v]) => `${k} — ${v.toFixed(1)}`).join('; ')}`);
      if (lines.length) {
        const content = `Личный контекст за ${Math.max(1, historyDays)} дней:\n` + lines.join('\n');
        personalContext = truncateContext(content);
      }
    } catch {}

    // Вызов Gemini (JSON-приоритет) с безопасным фоллбеком
    let textSummary = '';
    let ai: any | undefined;
    let aiMeta: any | undefined;
    try {
      const aiResult = await geminiService.analyzeTradingDataJSON(enrichedTrades as any, marketConditionsForAI, lang, schema, personalContext);
      if (aiResult?.ai) {
        ai = aiResult.ai;
        textSummary = ai.summary || '';
        aiMeta = aiResult.meta;
      } else if (aiResult?.rawText) {
        // Постобработка: конвертируем текст в структуру V2
        try {
          const coerced = coerceTextToV2(aiResult.rawText);
          ai = coerced;
          textSummary = coerced.summary || aiResult.rawText;
          aiMeta = { ...(aiResult.meta || {}), schema: 'v2', coerced: true };
        } catch {
          textSummary = aiResult.rawText;
          aiMeta = aiResult.meta;
        }
      } else {
        textSummary = 'ИИ-анализ временно недоступен. Ниже приведены структурированные данные для ручного разбора.';
      }
    } catch (e: any) {
      textSummary = 'ИИ-анализ временно недоступен. Ниже приведены структурированные данные для ручного разбора.';
    }
    // Серверные метрики по сделкам (если переданы)
    const profits = (trades as any[]).map((t) => Number((t as any)?.profit || 0));
    const tradesCount = profits.length;
    const totalProfit = profits.reduce((a, b) => a + b, 0);
    const wins = profits.filter((p) => p > 0).length;
    const winRate = tradesCount ? wins / tradesCount : 0;
    const avgProfit = tradesCount ? totalProfit / tradesCount : 0;

    const structuredInsights = {
      symbols: symbols.map((s) => normalizeJournalSymbol(String(s))),
      period: { from, to, timespan },
      metrics: { tradesCount, wins, winRate, totalProfit, avgProfit },
    };

    const response: any = {
      textSummary,
      structuredInsights,
      ai: ai || {},
      aiLang: lang,
    };

    if ((body as any)?.includeRaw) {
      response.candles = candlesBySymbol;
    }
    if ((body as any)?.includeContext) {
      response.marketConditions = marketConditions;
    }

    return this.handleSuccess(res, response);
  });
}

export default new TradingController();
