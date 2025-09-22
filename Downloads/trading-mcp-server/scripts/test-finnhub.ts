import 'dotenv/config';
import finnhubService from '../src/services/finnhub.service';

async function main() {
  const from = new Date(Date.now() - 7*24*60*60*1000).toISOString();
  const to = new Date().toISOString();
  console.log('[test] FINNHUB_DEBUG =', process.env.FINNHUB_DEBUG);
  console.log('[test] FINNHUB_API_KEY present =', !!process.env.FINNHUB_API_KEY);

  console.log('[test] Fetching macro data for window:', { from, to });
  const macro = await finnhubService.getMacroData(from, to);
  const sizes = Object.fromEntries(Object.entries(macro as any).map(([k,v]: any) => [k, Array.isArray(v?.series) ? v.series.length : 0]));
  console.log('[test] Macro sizes =', sizes);

  const calFrom = new Date(Date.now() - 2*24*60*60*1000).toISOString();
  const calTo = new Date(Date.now() + 2*24*60*60*1000).toISOString();
  console.log('[test] Fetching economic calendar window:', { from: calFrom, to: calTo });
  const cal = await finnhubService.getEconomicCalendar(calFrom, calTo, ['high','medium']);
  console.log('[test] Economic calendar count =', cal.length);
}

main().catch((e) => {
  console.error('[test] Error', e);
  process.exit(1);
});
