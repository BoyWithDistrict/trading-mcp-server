import { validateAiResultV2 } from '../src/utils/ai-schema';

describe('validateAiResultV2', () => {
  test('accepts valid object', () => {
    const obj = {
      summary: 'ok',
      marketContext: 'context',
      tradeAnalysis: 'analysis',
      psychology: 'psy',
      strengths: ['a'],
      weaknesses: ['b'],
      recommendations: ['c']
    };
    const v = validateAiResultV2(obj);
    expect(v.ok).toBe(true);
  });

  test('rejects missing fields', () => {
    const bad = { summary: '', strengths: [], weaknesses: [], recommendations: [] } as any;
    const v = validateAiResultV2(bad);
    expect(v.ok).toBe(false);
  });
});
