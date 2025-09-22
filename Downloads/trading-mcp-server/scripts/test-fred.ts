import 'dotenv/config';
import fredService from '../src/services/fred.service';

async function main() {
  const from = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 1y window for visibility
  const to = new Date().toISOString();

  console.log('[test] FRED_API_KEY present =', !!process.env.FRED_API_KEY);
  console.log('[test] Fetching FRED macro data (US) for window:', { from, to });
  const macro = await fredService.getMacroDataUS(from, to);
  const sizes = Object.fromEntries(Object.entries(macro as any).map(([k, v]: any) => [k, Array.isArray(v?.series) ? v.series.length : 0]));
  console.log('[test] FRED Macro sizes =', sizes);

  const peek = (macro as any).cpi?.series?.slice(-3) || [];
  console.log('[test] CPI last 3 points =', peek);
}

main().catch((e) => {
  console.error('[test] Error', e);
  process.exit(1);
});
