import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Provider: Finnhub
  const provider = await prisma.macroProvider.upsert({
    where: { name: 'finnhub' },
    update: { active: true },
    create: { name: 'finnhub', baseUrl: 'https://finnhub.io', active: true },
  });

  // Country → Currency mappings
  const countryCurrency: Array<{ country: string; currency: string }> = [
    { country: 'US', currency: 'USD' },
    { country: 'EU', currency: 'EUR' },
    { country: 'UK', currency: 'GBP' },
  ];
  for (const item of countryCurrency) {
    await prisma.countryCurrency.upsert({
      where: { country: item.country },
      update: { currency: item.currency },
      create: { country: item.country, currency: item.currency },
    });
  }

  // Symbol → Countries relevance map
  const symbolCountries: Array<{ symbol: string; countries: string[] }> = [
    { symbol: 'EUR/USD', countries: ['EU', 'US'] },
    { symbol: 'GBP/USD', countries: ['UK', 'US'] },
  ];
  for (const sc of symbolCountries) {
    await prisma.symbolCountry.upsert({
      where: { symbol: sc.symbol },
      update: { countries: JSON.stringify(sc.countries) },
      create: { symbol: sc.symbol, countries: JSON.stringify(sc.countries) },
    });
  }

  // Note: MacroSeries will be created lazily when first fetched from provider
  // (read-through strategy). We seed only provider and mappings here.

  console.log('Prisma seed completed: provider, country/currency, symbol/country mappings');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
