import 'dotenv/config';
import fetch from 'node-fetch';

const BASE = process.env.BASE_URL || 'http://localhost:3001';
const API_KEY = process.env.API_KEY || 'your-super-secret-key';

async function main() {
  // Быстрая проверка здоровья
  try {
    const health = await fetch(`${BASE}/api/health`, { headers: { 'x-api-key': API_KEY } });
    console.log('Health:', health.status, await health.text());
  } catch (e) {
    console.log('Health check failed:', String((e as any)?.message || e));
  }

  const url = `${BASE}/api/trades/analysis/period`;
  const now = Date.now();
  const body = {
    from: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date(now).toISOString(),
    timespan: 'hour',
    symbols: ['EUR/USD', 'GBP/USD'],
    includeRaw: false,
    trades: [
      { id: 't1', symbol: 'EUR/USD', profit: 120.5, entryTime: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(), exitTime: new Date(now - 6 * 24 * 60 * 60 * 1000 + 3600000).toISOString(), price: 1.08, amount: 10000 },
      { id: 't2', symbol: 'GBP/USD', profit: -45.3, entryTime: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(), exitTime: new Date(now - 5 * 24 * 60 * 60 * 1000 + 5400000).toISOString(), price: 1.27, amount: 8000 }
    ]
  } as any;

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  console.log('Status:', r.status);
  console.log('Body:', text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
