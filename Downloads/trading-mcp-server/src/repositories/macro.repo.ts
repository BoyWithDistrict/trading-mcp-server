import prisma from '../services/prisma';

export type UpsertSeriesInput = {
  providerName: string; // e.g. 'finnhub'
  code: string;         // e.g. 'CPI_US', 'UNEMPLOYMENT_UK'
  country?: string;     // 'US' | 'EU' | 'UK' | ...
  name?: string;
  frequency?: string;   // monthly | weekly | daily | quarterly
  unit?: string;        // %, index, etc
  decimals?: number;
};

export async function ensureProvider(name: string, baseUrl?: string) {
  return prisma.macroProvider.upsert({
    where: { name },
    update: { baseUrl, active: true },
    create: { name, baseUrl, active: true },
  });
}

export async function upsertSeries(input: UpsertSeriesInput) {
  const provider = await ensureProvider(input.providerName);
  return prisma.macroSeries.upsert({
    where: { providerId_code: { providerId: provider.id, code: input.code } },
    update: {
      country: input.country,
      name: input.name,
      frequency: input.frequency,
      unit: input.unit,
      decimals: input.decimals ?? undefined,
      active: true,
    },
    create: {
      providerId: provider.id,
      code: input.code,
      country: input.country,
      name: input.name,
      frequency: input.frequency,
      unit: input.unit,
      decimals: input.decimals ?? undefined,
      active: true,
    },
  });
}

export async function upsertObservation(seriesId: string, date: Date, value: number, revisionSeq = 0, revisionDate?: Date) {
  // Mark previous latest as not-latest for this date if exists, then insert new and update MacroLatest
  const obs = await prisma.macroObservation.upsert({
    where: {
      seriesId_date_revisionSeq: {
        seriesId,
        date,
        revisionSeq,
      },
    },
    update: {
      value,
      revisionDate: revisionDate ?? undefined,
      isLatest: true,
    },
    create: {
      seriesId,
      date,
      value,
      revisionSeq,
      revisionDate: revisionDate ?? undefined,
      isLatest: true,
    },
  });

  // Update MacroLatest (one row per series)
  await prisma.macroLatest.upsert({
    where: { seriesId },
    update: {
      date,
      value,
      revisionSeq,
    },
    create: {
      seriesId,
      date,
      value,
      revisionSeq,
    },
  });

  return obs;
}

export async function getSeriesLatest(seriesCode: string, providerName = 'finnhub') {
  const provider = await prisma.macroProvider.findUnique({ where: { name: providerName } });
  if (!provider) return null;
  const series = await prisma.macroSeries.findUnique({ where: { providerId_code: { providerId: provider.id, code: seriesCode } } });
  if (!series) return null;
  const latest = await prisma.macroLatest.findUnique({ where: { seriesId: series.id } });
  return latest ? { series, latest } : null;
}

export async function getOrCreateCountryCurrency(country: string) {
  return prisma.countryCurrency.upsert({
    where: { country },
    update: {},
    create: { country, currency: country },
  });
}

export async function findSeriesByProviderAndCode(providerName: string, code: string) {
  const provider = await prisma.macroProvider.findUnique({ where: { name: providerName } });
  if (!provider) return null;
  return prisma.macroSeries.findUnique({ where: { providerId_code: { providerId: provider.id, code } } });
}

export async function getSeriesObservationsLatest(seriesId: string, from: Date, to: Date) {
  return prisma.macroObservation.findMany({
    where: { seriesId, date: { gte: from, lte: to }, isLatest: true },
    orderBy: { date: 'asc' },
    select: { date: true, value: true },
  });
}

export function makeSeriesCode(country: string | undefined, key: string) {
  const c = (country || 'GLOBAL').toUpperCase();
  const k = key.toUpperCase();
  return `${c}_${k}`;
}
