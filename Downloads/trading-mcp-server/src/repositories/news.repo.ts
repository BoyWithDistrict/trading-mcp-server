import prisma from '../services/prisma';

export type UpsertArticleInput = {
  provider: string;
  title: string;
  url: string;
  source?: string | null;
  publishedAt: Date;
  language?: string | null;
  symbols?: string[];    // stored as JSON string
  countries?: string[];  // stored as JSON string
  topics?: string[];     // stored as JSON string
  sentiment?: number | null;
};

export async function upsertArticle(input: UpsertArticleInput) {
  // dedupe by URL
  const data = {
    provider: input.provider,
    title: input.title.slice(0, 300),
    url: input.url,
    source: input.source || null,
    publishedAt: input.publishedAt,
    language: input.language || null,
    symbols: input.symbols ? JSON.stringify(input.symbols) : null,
    countries: input.countries ? JSON.stringify(input.countries) : null,
    topics: input.topics ? JSON.stringify(input.topics) : null,
    sentiment: input.sentiment ?? null,
  } as const;

  const article = await prisma.newsArticle.upsert({
    where: { url: input.url },
    update: data,
    create: data,
  });
  return article;
}

export async function createSymbolIndex(symbol: string, articleId: string, publishedAt: Date) {
  return prisma.newsSymbolIndex.create({
    data: { symbol, articleId, publishedAt },
  });
}

export async function upsertArticleWithIndex(symbol: string, input: UpsertArticleInput) {
  const article = await upsertArticle(input);
  // ensure index exists (idempotent by unique? we can guard by findFirst)
  const existing = await prisma.newsSymbolIndex.findFirst({ where: { symbol, articleId: article.id } });
  if (!existing) {
    await createSymbolIndex(symbol, article.id, input.publishedAt);
  }
  return article;
}

export async function getArticlesBySymbolAndPeriod(symbol: string, from: Date, to: Date, limit: number) {
  const rows = await prisma.newsSymbolIndex.findMany({
    where: { symbol, publishedAt: { gte: from, lte: to } },
    orderBy: { publishedAt: 'desc' },
    take: limit,
    select: { article: true },
  });
  return rows.map((r) => r.article);
}
