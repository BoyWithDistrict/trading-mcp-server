import { AiAnalysisJSONv2 } from './ai-schema';

function cleanup(text: string): string {
  return (text || '').replace(/```[a-zA-Z]*\n?|```/g, '').trim();
}

function pickFirstSentences(text: string, maxChars = 400): string {
  const t = cleanup(text);
  if (t.length <= maxChars) return t;
  // simple sentence split
  const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = '';
  for (const p of parts) {
    if ((out + ' ' + p).trim().length > maxChars) break;
    out = (out ? out + ' ' : '') + p;
  }
  return out || t.slice(0, maxChars);
}

function extractList(text: string): string[] {
  const t = cleanup(text);
  const bullets = t.split(/\n|;|\u2022|\*/).map(s => s.trim()).filter(Boolean);
  if (bullets.length > 1) return bullets.slice(0, 10);
  // fall back to short phrases by punctuation
  return t.split(/[,.;]\s+/).map(s => s.trim()).filter(s => s.length > 2).slice(0, 10);
}

export function coerceTextToV2(raw: string): AiAnalysisJSONv2 {
  const t = cleanup(raw);
  // Try to detect sections by common Russian headings
  const map: Record<string, string> = {};
  let current = 'summary';
  t.split(/\n+/).forEach(line => {
    const L = line.trim();
    const low = L.toLowerCase();
    if (/^контекст|^рынок|^market/.test(low)) current = 'marketContext';
    else if (/^сделк|^trade/.test(low)) current = 'tradeAnalysis';
    else if (/^психолог|^psycho/.test(low)) current = 'psychology';
    else if (/^сильн|^strength/.test(low)) current = 'strengths';
    else if (/^слаб|^ошиб|^weak/.test(low)) current = 'weaknesses';
    else if (/^рекоменд|^recom/.test(low)) current = 'recommendations';
    map[current] = (map[current] ? map[current] + '\n' : '') + L;
  });

  const summary = pickFirstSentences(map.summary || t, 400);
  const marketContext = pickFirstSentences(map.marketContext || map.summary || t, 600);
  const tradeAnalysis = pickFirstSentences(map.tradeAnalysis || t, 800);
  const psychology = pickFirstSentences(map.psychology || '', 400);
  const strengths = extractList(map.strengths || '');
  const weaknesses = extractList(map.weaknesses || '');
  const recommendations = extractList(map.recommendations || map.tradeAnalysis || t);

  return {
    summary: summary || 'Краткое резюме недоступно.',
    marketContext: marketContext || 'Контекст рынка не был явно указан в тексте ответа.',
    tradeAnalysis: tradeAnalysis || 'Разбор сделок не был явно указан в тексте ответа.',
    psychology: psychology || 'Психологические аспекты не были явно указаны в тексте ответа.',
    strengths: strengths.length ? strengths : ['Достоверные сильные стороны не выделены.'],
    weaknesses: weaknesses.length ? weaknesses : ['Ошибки не были явно выделены.'],
    recommendations: recommendations.length ? recommendations : ['Рекомендации не были явно указаны.']
  };
}
