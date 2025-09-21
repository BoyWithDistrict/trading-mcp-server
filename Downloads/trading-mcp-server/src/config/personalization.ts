type SynonymRule = { pattern: RegExp; canon: string };

export type PersonalizationWeights = {
  baseV2: number;
  baseOther: number;
  symbolMatch: number;
  symbolOther: number;
  dirMatchBoost: number;
  recFactor: number;
  maxSymbolsInContext: number;
  maxContextChars: number;
  topPatternsPerSymbol: number;
};

const DEFAULT_WEIGHTS: PersonalizationWeights = {
  baseV2: 1.0,
  baseOther: 0.7,
  symbolMatch: 1.0,
  symbolOther: 0.5,
  dirMatchBoost: 1.1,
  recFactor: 0.6,
  maxSymbolsInContext: 3,
  maxContextChars: 420,
  topPatternsPerSymbol: 2,
};

// Базовый словарь кластеров синонимов
const DEFAULT_SYNONYMS: SynonymRule[] = [
  { pattern: /контр[-\s]?тренд|против\s+тренда/i, canon: 'контртренд без подтверждения' },
  { pattern: /нет\s*стоп|отсутствие\s*стоп|без\s*стоп|stop[-\s]?loss\s*нет/i, canon: 'отсутствие стоп-лосса' },
  { pattern: /перетягивание\s*стоп|слишком\s*узкий\s*стоп/i, canon: 'неоптимальные стоп-лоссы' },
  { pattern: /пересиживание|удержание\s*убыточных|надеюсь\s*отрастет/i, canon: 'пересиживание убытков' },
  { pattern: /нет\s*плана|отсутствие\s*плана|не\s*следовал\s*плану/i, canon: 'несоблюдение торгового плана' },
  { pattern: /переторговля|overtrading/i, canon: 'переторговля' },
  { pattern: /вход\s*без\s*сигнала|ранний\s*вход|поздний\s*вход/i, canon: 'тайминг входа/выхода' },
];

function parseWeightsFromEnv(): Partial<PersonalizationWeights> {
  try {
    const raw = process.env.PERSONAL_WEIGHTS;
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj;
  } catch {
    return {};
  }
}

function parseSynonymsFromEnv(): SynonymRule[] | undefined {
  try {
    const raw = process.env.PERSONAL_SYNONYMS;
    if (!raw) return undefined;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return undefined;
    const out: SynonymRule[] = [];
    for (const it of arr) {
      if (typeof it?.pattern === 'string' && typeof it?.canon === 'string') {
        const flags = typeof it.flags === 'string' ? it.flags : 'i';
        out.push({ pattern: new RegExp(it.pattern, flags), canon: it.canon });
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

export function getPersonalizationWeights(): PersonalizationWeights {
  const w = { ...DEFAULT_WEIGHTS, ...parseWeightsFromEnv() } as PersonalizationWeights;
  return w;
}

export function getSynonymRules(): SynonymRule[] {
  const env = parseSynonymsFromEnv();
  return env && env.length ? env : DEFAULT_SYNONYMS;
}

export function makePhraseNormalizer() {
  const rules = getSynonymRules();
  return (raw: string): string => {
    const s = String(raw || '').toLowerCase().trim();
    if (!s) return '';
    for (const r of rules) if (r.pattern.test(s)) return r.canon;
    return s;
  };
}

export function truncateContext(text: string, maxChars = getPersonalizationWeights().maxContextChars): string {
  if (!text) return text;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}
