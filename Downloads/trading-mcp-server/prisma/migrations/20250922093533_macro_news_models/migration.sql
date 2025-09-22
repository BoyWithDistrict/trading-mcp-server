-- CreateTable
CREATE TABLE "MacroProvider" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "MacroSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "country" TEXT,
    "name" TEXT,
    "frequency" TEXT,
    "unit" TEXT,
    "decimals" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "MacroSeries_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "MacroProvider" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MacroObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seriesId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    "revisionSeq" INTEGER NOT NULL DEFAULT 0,
    "revisionDate" DATETIME,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MacroObservation_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MacroSeries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MacroLatest" (
    "seriesId" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "value" REAL NOT NULL,
    "revisionSeq" INTEGER NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MacroLatest_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MacroSeries" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT,
    "publishedAt" DATETIME NOT NULL,
    "language" TEXT,
    "symbols" TEXT,
    "countries" TEXT,
    "topics" TEXT,
    "sentiment" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NewsSymbolIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    CONSTRAINT "NewsSymbolIndex_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "NewsArticle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SymbolCountry" (
    "symbol" TEXT NOT NULL PRIMARY KEY,
    "countries" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CountryCurrency" (
    "country" TEXT NOT NULL PRIMARY KEY,
    "currency" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MacroProvider_name_key" ON "MacroProvider"("name");

-- CreateIndex
CREATE INDEX "MacroSeries_country_idx" ON "MacroSeries"("country");

-- CreateIndex
CREATE UNIQUE INDEX "MacroSeries_providerId_code_key" ON "MacroSeries"("providerId", "code");

-- CreateIndex
CREATE INDEX "MacroObservation_seriesId_date_idx" ON "MacroObservation"("seriesId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MacroObservation_seriesId_date_revisionSeq_key" ON "MacroObservation"("seriesId", "date", "revisionSeq");

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_url_key" ON "NewsArticle"("url");

-- CreateIndex
CREATE INDEX "NewsSymbolIndex_symbol_publishedAt_idx" ON "NewsSymbolIndex"("symbol", "publishedAt");
