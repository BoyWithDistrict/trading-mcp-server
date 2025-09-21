export type AiAnalysisJSON = {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  riskAssessment?: {
    period?: string;
    instruments?: Record<string, string>;
    keyRisks?: string[];
  };
  assumptions?: string[];
};

export function validateAiResult(obj: any): { ok: true } | { ok: false; reason: string } {
  if (obj == null || typeof obj !== 'object') return { ok: false, reason: 'Not an object' };
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) return { ok: false, reason: 'summary must be non-empty string' };
  if (!Array.isArray(obj.strengths) || !obj.strengths.every((s: any) => typeof s === 'string')) return { ok: false, reason: 'strengths must be string[]' };
  if (!Array.isArray(obj.weaknesses) || !obj.weaknesses.every((s: any) => typeof s === 'string')) return { ok: false, reason: 'weaknesses must be string[]' };
  if (!Array.isArray(obj.recommendations) || !obj.recommendations.every((s: any) => typeof s === 'string')) return { ok: false, reason: 'recommendations must be string[]' };
  if (obj.riskAssessment != null) {
    const r = obj.riskAssessment;
    if (typeof r !== 'object') return { ok: false, reason: 'riskAssessment must be object' };
    if (r.period != null && typeof r.period !== 'string') return { ok: false, reason: 'riskAssessment.period must be string' };
    if (r.instruments != null && (typeof r.instruments !== 'object' || Array.isArray(r.instruments))) return { ok: false, reason: 'riskAssessment.instruments must be record' };
    if (r.keyRisks != null && (!Array.isArray(r.keyRisks) || !r.keyRisks.every((s: any) => typeof s === 'string'))) return { ok: false, reason: 'riskAssessment.keyRisks must be string[]' };
  }
  if (obj.assumptions != null && (!Array.isArray(obj.assumptions) || !obj.assumptions.every((s: any) => typeof s === 'string'))) return { ok: false, reason: 'assumptions must be string[]' };
  return { ok: true };
}

// --- V2 схема ---
export type AiAnalysisJSONv2 = {
  summary: string;
  marketContext: string;
  tradeAnalysis: string;
  psychology: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
};

export function validateAiResultV2(obj: any): { ok: true } | { ok: false; reason: string } {
  if (obj == null || typeof obj !== 'object') return { ok: false, reason: 'Not an object' };
  const mustBeNonEmptyString = (v: any, name: string) => (typeof v === 'string' && v.trim() ? null : `${name} must be non-empty string`);
  const err =
    mustBeNonEmptyString(obj.summary, 'summary') ||
    mustBeNonEmptyString(obj.marketContext, 'marketContext') ||
    mustBeNonEmptyString(obj.tradeAnalysis, 'tradeAnalysis') ||
    mustBeNonEmptyString(obj.psychology, 'psychology');
  if (err) return { ok: false, reason: err };
  if (!Array.isArray(obj.strengths) || !obj.strengths.every((s: any) => typeof s === 'string')) return { ok: false, reason: 'strengths must be string[]' };
  if (!Array.isArray(obj.weaknesses) || !obj.weaknesses.every((s: any) => typeof s === 'string')) return { ok: false, reason: 'weaknesses must be string[]' };
  if (!Array.isArray(obj.recommendations) || !obj.recommendations.every((s: any) => typeof s === 'string')) return { ok: false, reason: 'recommendations must be string[]' };
  return { ok: true };
}
