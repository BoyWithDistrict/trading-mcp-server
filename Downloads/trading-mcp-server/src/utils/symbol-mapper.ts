import logger from '../utils/logger';

// Нормализация и маппинг символов из журнала сделок в формат Polygon (forex)
// Правила:
// - Убираем хвостовые '+' (например, XAUUSD+ -> XAUUSD)
// - Uppercase
// - Кастомный словарь для несовпадающих символов (например, USOUSD -> XTIUSD)
// - Добавляем префикс 'C:' для форекс

const CUSTOM_MAP: Record<string, string> = {
  USOUSD: 'XTIUSD', // USOUSD (CFD WTI) маппим на стандартный тикер WTI
};

export function normalizeJournalSymbol(symbol: string): string {
  if (!symbol) return symbol as any;
  let s = symbol.trim().toUpperCase();
  // убрать хвостовой '+'
  if (s.endsWith('+')) s = s.slice(0, -1);
  return s;
}

export function mapToPolygonForexTicker(symbol: string, forexPrefix = 'C:'): string {
  const normalized = normalizeJournalSymbol(symbol);
  
  // Если символ уже содержит префикс (например, 'C:EURUSD'), считаем его полным тикером
  if (normalized.includes(':')) {
    logger.debug?.(`Symbol mapping: journal='${symbol}' already contains prefix -> polygon='${normalized}'`);
    return normalized;
  }

  // Удаляем все неалфанумерические символы (например, '/' в EUR/USD)
  const compact = (CUSTOM_MAP[normalized] || normalized).replace(/[^A-Z0-9]/g, '');
  const mapped = compact;
  const polygonTicker = `${forexPrefix}${mapped}`;
  logger.debug?.(`Symbol mapping: journal='${symbol}' -> normalized='${normalized}' -> mapped='${mapped}' -> polygon='${polygonTicker}'`);
  return polygonTicker;
}

export default { normalizeJournalSymbol, mapToPolygonForexTicker };
