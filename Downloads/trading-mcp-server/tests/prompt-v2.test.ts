// Snapshot-like sanity check for V2 prompt builder
// We access the private method via bracket notation to avoid exporting it.
import service from '../src/services/gemini.service';

describe('buildTradingAnalysisJSONPromptV2', () => {
  test('includes strict JSON instructions and personal context when provided', () => {
    const trades = [
      { id: 'T1', symbol: 'EURUSD', entryTime: '2025-09-02T10:00:00Z', exitTime: '2025-09-02T14:00:00Z', profit: 10, indicators: { entry: { rsi14: 28 }, exit: { rsi14: 45 } } }
    ];
    const marketConditions = {
      from: '2025-09-01T00:00:00Z',
      to: '2025-09-07T23:59:59Z',
      timespan: 'hour',
      candles: {
        EURUSD: [
          { t: 1, o: 1.1, h: 1.2, l: 1.0, c: 1.15, v: 1000 },
          { t: 2, o: 1.15, h: 1.16, l: 1.14, c: 1.155, v: 1000 },
        ]
      },
      marketIndicators: { EURUSD: { avgClose: 1.1525 } },
      news: {}
    };
    const personal = 'Личный контекст за 14 дней: отсутствие стопа — 2; контртренд без подтверждения — 3';
    const buildV2 = (service as any)['buildTradingAnalysisJSONPromptV2'].bind(service);
    const prompt: string = buildV2(trades, marketConditions, 'ru', personal);
    expect(prompt).toContain('Верни СТРОГО следующий JSON');
    expect(prompt).toContain('Не используй форматирование Markdown');
    // Проверяем, что персональный контекст действительно присутствует в JSON-данных
    expect(prompt).toContain('personalContext');
    expect(prompt).toContain('recommendations');
  });
});
