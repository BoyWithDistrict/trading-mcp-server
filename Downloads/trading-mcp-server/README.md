# trading-mcp-server
## Персонализация

Сервер формирует «личный контекст» из истории ваших ИИ‑анализов за последние N дней (по умолчанию 14), агрегируя повторяющиеся ошибки и рекомендации. Используются веса по:

- Валидности схемы: записи, прошедшие валидацию V2, получают больший вес.
- Символам: совпадающие с текущим запросом символы получают больший вес.
- Направлению сделок: если текущий запрос содержит long/short и соответствующие упоминания есть в истории, вес повышается.

Результат вставляется в промпт V2 внутри поля `personalContext` и влияет на рекомендации.

Пример запроса с персонализацией:

```json
{
  "from": "2025-09-01T00:00:00Z",
  "to": "2025-09-07T23:59:59Z",
  "symbols": ["EURUSD", "XAUUSD", "USOUSD"],
  "timespan": "hour",
  "schema": "v2",
  "historyDays": 14,
  "trades": [
    { "id": "L1", "symbol": "EURUSD", "direction": "buy",   "entryTime": "2025-09-02T10:00:00Z", "exitTime": "2025-09-02T13:00:00Z", "profit": 20 },
    { "id": "S1", "symbol": "XAUUSD+", "direction": "sell",  "entryTime": "2025-09-03T09:00:00Z", "exitTime": "2025-09-03T12:00:00Z", "profit": -15 },
    { "id": "L2", "symbol": "USOUSD",  "direction": "long",  "entryTime": "2025-09-04T11:00:00Z", "exitTime": "2025-09-04T16:00:00Z", "profit": 8.5 }
  ]
}
```

Фрагмент промпта (данные блока, которые получает ИИ):

```json
{
  "trades": [ /* ... */ ],
  "period": { /* ... */ },
  "marketSummary": { /* ... */ },
  "marketIndicators": { /* ... */ },
  "news": {},
  "personalContext": "Личный контекст за 14 дней:\nEURUSD: контртренд без подтверждения — 3.0; отсутствие стоп-лосса — 2.0\nXAUUSD: переторговля — 2.0\nИтого: тайминг входа/выхода — 4.0; несоблюдение торгового плана — 3.0"
}
```

### Настройка персонализации через .env

- Веса и лимиты (JSON):

```env
PERSONAL_WEIGHTS={"baseV2":1.0,"baseOther":0.7,"symbolMatch":1.0,"symbolOther":0.5,"dirMatchBoost":1.1,"recFactor":0.6,"maxSymbolsInContext":3,"maxContextChars":420,"topPatternsPerSymbol":2}
```

- Дополнение словаря синонимов (JSON‑массив правил):

```env
PERSONAL_SYNONYMS=[
  {"pattern":"контр[-\\s]?тренд|против\\s+тренда","flags":"i","canon":"контртренд без подтверждения"},
  {"pattern":"ловля\\s*вершин|поймать\\s*вершину","flags":"i","canon":"контртренд без подтверждения"}
]
```

Если переменные окружения заданы, сервер подхватит их при старте и будет использовать вместо встроенных значений. Ограничение длины блока `personalContext` управляется параметром `maxContextChars`.


MCP-сервер для приложения Trading Journal. Позволяет ИИ-ассистенту получать рыночные данные (Polygon.io) и выполнять анализ сделок пользователя.

## Возможности (MVP)
- Получение OHLC (Aggregates v2) для форекс/CFD тикеров через Polygon.io
- Анализ периода: подтягивает свечи по символам/сделкам и вызывает Gemini для текстового резюме и структурированных инсайтов
- Нормализация символов журнала в формат Polygon (EURUSD → C:EURUSD, XAUUSD+ → C:XAUUSD, USOUSD → C:XTIUSD)
- Ретраи, таймауты, базовый кэш ответов
- Аутентификация по API-ключу (заголовок `x-api-key`)
- Обогащение анализа новостями (NewsAPI) с агрегированием по символам и временным диапазонам
- Локальная БД SQLite через Prisma: CRUD по сделкам, аудит изменений, хранение истории ИИ‑анализов
- Метрики по сделкам: сводка, PnL по неделям/дням, максимальная просадка

## Требования
- Node.js 18+
- Polygon API Key
- (опционально) Google Gemini API Key для эндпоинта анализа периода

## Установка и запуск
```bash
npm install
npm run dev      # dev-режим (ts-node-dev)
# либо
npm run build && npm start
```

## Переменные окружения
Создайте `.env` (см. `.env.example`):

- `PORT` — порт сервера (по умолчанию 3001)
- `NODE_ENV` — окружение (`development` | `production`)
- `API_KEY` — ключ для доступа к API сервера (заголовок `x-api-key`)
- `POLYGON_API_KEY` — ключ Polygon.io
- `GEMINI_API_KEY` — ключ Google Gemini (для анализа периода)
- `GEMINI_MODEL` — модель Gemini (например, `gemini-2.5-flash`)
- `GEMINI_FALLBACK_MODEL` — запасная модель для деградации
- `GEMINI_TIMEOUT_MS` — таймаут вызова Gemini, мс
- `GEMINI_PROXY_URL` — при необходимости прокси только для Gemini (например, `socks5h://127.0.0.1:1080`)
- `CORS_ORIGIN` — разрешённый источник CORS
- `DATABASE_URL` — строка подключения Prisma (для SQLite: `file:./prisma/dev.db`)
- Настройки Polygon (опционально):
  - `POLYGON_TIMEOUT_MS` (по умолчанию 15000)
  - `POLYGON_MAX_RETRIES` (по умолчанию 3)
  - `POLYGON_BACKOFF_BASE_MS` (по умолчанию 300)
  - `POLYGON_CACHE_TTL_MS` (по умолчанию 600000)
  - Переопределение TTL по таймфреймам (опц.): `POLYGON_TTL_MINUTE_MS`, `POLYGON_TTL_HOUR_MS`, `POLYGON_TTL_DAY_MS`
- Прокси для обхода корпоративных ограничений:
  - Глобальные: `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`
  - Для Polygon рекомендуем исключение: `NO_PROXY=api.polygon.io`
  - Для новостного провайдера отдельный прокси: `NEWS_PROXY_URL` (например, `socks5h://127.0.0.1:1080`)
- NewsAPI:
  - `NEWSAPI_ENABLED` — `true|false` для включения новостей
  - `NEWSAPI_KEY` — ключ NewsAPI
  - `NEWSAPI_LANGUAGE` — `en|ru` язык новостей
  - `NEWSAPI_MAX_PER_SYMBOL` — ограничение кол-ва новостей на символ
  - `NEWSAPI_TIMEOUT_MS` — таймаут запросов к NewsAPI, мс

## Аутентификация
Все защищённые маршруты под префиксом `/api` требуют заголовок:
```
x-api-key: <ваш_API_KEY>
```

## Маршруты

### GET `/api/trades/market/ohlc`
Получение OHLC (агрегатов) из Polygon для форекс-тикера.

Параметры query:
- `symbol` (обяз.) — например, `EURUSD`, `XAUUSD+`, `USOUSD`
- `from` (обяз.) — ISO дата/время, например `2024-09-01T00:00:00Z`
- `to` (обяз.) — ISO дата/время
- `timespan` — `day` | `hour` | `minute` (по умолчанию `day`)

Пример (PowerShell):
```powershell
$headers = @{ "x-api-key" = "your-super-secret-key" }
$uri = "http://localhost:3001/api/trades/market/ohlc?symbol=EURUSD&from=2024-09-01T00:00:00Z&to=2024-09-10T00:00:00Z&timespan=day"
Invoke-RestMethod -Method GET -Uri $uri -Headers $headers
```

Пример (curl):
```bash
curl -H "x-api-key: your-super-secret-key" \
  "http://localhost:3001/api/trades/market/ohlc?symbol=EURUSD&from=2024-09-01T00:00:00Z&to=2024-09-10T00:00:00Z&timespan=day"
```

Ответ (усечённо):
```json
{
  "success": true,
  "data": {
    "symbol": "EURUSD",
    "timespan": "day",
    "from": "2024-09-01T00:00:00Z",
    "to": "2024-09-10T00:00:00Z",
    "candles": [ { "t": 1725148800000, "o": 1.10498, "h": 1.10498, "l": 1.1043, "c": 1.10444, "v": 2322 } ]
  }
}
```

Дополнительно (V2 схема и персонализация):

- Параметр `schema`: `"v1" | "v2"` — выбор схемы ответа ИИ (по умолчанию `v2`).
- Параметр `historyDays`: число дней для персонализации (по умолчанию `14`). Сервер выберет последние анализы из БД и добавит краткую статистику повторяющихся ошибок в промпт (личный контекст).
- Снимки индикаторов на момент сделки автоматически добавляются к каждой сделке (`indicators.entry/exit`): `ema20/50/200`, `sma20/50/200`, `rsi14`, `atr14`, `atrPct`, `ema200Slope`, `closeVsEma200Bps`.

Структура ответа ИИ в режиме `schema=v2` (строго JSON без Markdown):

```json
{
  "summary": "string",
  "marketContext": "string",
  "tradeAnalysis": "string",
  "psychology": "string",
  "strengths": ["string"],
  "weaknesses": ["string"],
  "recommendations": ["string"]
}
```

Технические детали:

- Промпт V2 содержит явный запрет на Markdown и тройные обратные кавычки. Если модель вернёт Markdown/код-блок, сервер выполнит репромпт с требованием выдать ТОЛЬКО JSON.
- Если модель всё же вернёт «водянистый» текст, сервер попытается эвристически привести текст к V2-структуре (постобработка) и вернуть валидный JSON, пригодный для рендеринга UI.
- В ответе присутствует `aiMeta.schema`, а при постобработке добавляется флаг `coerced: true`.

### POST `/api/trades/analysis/period`
Анализ периода: по сделкам/символам подтягивает OHLC и вызывает Gemini.

Тело запроса:
```json
{
  "from": "2024-09-01T00:00:00Z",
  "to": "2024-09-10T00:00:00Z",
  "symbols": ["EURUSD", "XAUUSD+", "USOUSD"],
  "timespan": "day",
  "includeRaw": true,
  "trades": [
    {
      "id": 123,
      "symbol": "EURUSD",
      "direction": "buy",
      "entryTime": "2024-09-02T10:00:00Z",
      "exitTime": "2024-09-02T14:00:00Z",
      "entryPrice": 1.085,
      "qty": 10000,
      "profit": 45.5
    }
  ]
}
```

Ответ (усечённо):
```json
{
  "success": true,
  "data": {
    "textSummary": "…русскоязычное резюме…",
    "structuredInsights": {
      "symbols": ["EURUSD","XAUUSD","XTIUSD"],
      "period": { "from":"…","to":"…","timespan":"day" }
    },
    "candles": { "EURUSD": [ … ], "XAUUSD": [ … ], "XTIUSD": [ … ] }
  }
}
```

Примечания по новостям:
- При `NEWSAPI_ENABLED=true` сервер дополнительно собирает дайджест новостей по каждому символу за указанный период и учитывает их при формировании `marketConditions` для ИИ.
- Язык новостей управляется `NEWSAPI_LANGUAGE` (`en|ru`). Для нестабильных сетей можно указать отдельный прокси `NEWS_PROXY_URL`.

## Валидация и ошибки
- Валидация параметров выполнена через `express-validator` и `utils/validation.validate`.
- Ошибки Polygon:
  - Таймауты и сетевые проблемы → HTTP 504 ("Polygon connectivity timeout")
  - 429/5xx → прокидывается соответствующий статус
  - Прочие — 502/соответствующий код
- Общие ошибки логируются через `winston`.

## Прокси/VPN
Если используете VPN/корпоративную сеть и браузер видит Polygon, а сервер — нет, укажите прокси для Node.js:
```powershell
setx HTTPS_PROXY "http://user:pass@proxy.host:port"
setx HTTP_PROXY  "http://user:pass@proxy.host:port"
setx NO_PROXY "localhost,127.0.0.1"
```
Перезапустите терминал и сервер.

Точечные прокси:
- `GEMINI_PROXY_URL` — только для вызовов Gemini
- `NEWS_PROXY_URL` — только для вызовов NewsAPI
- Для Polygon наоборот рекомендовано обходить прокси: `NO_PROXY=api.polygon.io`

## Полезные скрипты
- `npm run dev` — запуск сервера в dev-режиме
- `npm run build` — сборка TypeScript в `dist/`
- `npm start` — запуск собранного кода
- `npm run prisma:generate` — генерация Prisma Client
- `npm run prisma:migrate` — миграция схемы (создаст/обновит файл БД)
- `npm run smoke:analysis` — локальный прогон сценария анализа периода (см. `scripts/smoke-analysis.ts`)

## Локальная БД (SQLite + Prisma)
1. Установите зависимости: `npm install`
2. В `.env` добавьте:
```
DATABASE_URL="file:./prisma/dev.db"
```
3. Примените миграции и сгенерируйте клиент:
```
npm run prisma:migrate
npm run prisma:generate
```
4. Перезапустите сервер: `npm run dev`

## Работа с БД (CRUD и история)
- `POST /api/db/trades` — создать сделку
  - Тело: `{ ticker, strategy?, entryTime?, exitTime?, direction?, entryPrice?, stopLoss?, takeProfit?, lot?, riskPercent?, profit?, emotion?, isPlanned?, planId? }`
- `GET /api/db/trades?symbol=&from=&to=&limit=&cursor=` — выборка сделок с пагинацией
  - Фильтры: `symbol` (тикер), `from`/`to` по `entryTime`
- `PUT /api/db/trades/:id` — обновить частично
  - Тело: любые поля, перечисленные выше
- `DELETE /api/db/trades/:id` — мягкое удаление (`deletedAt`)

- `GET /api/db/audit?entityType=&entityId=&limit=&cursor=` — аудит изменений
  - `entityType`: `Trade` | `TradePlan` | `AIAnalysis` | `Folder` | `Screenshot`
  - Возвращает список событий с полями: `entityType`, `entityId`, `action`, `before`, `after`, `timestamp`

- `GET /api/db/analyses?tradeId=&from=&to=&limit=&cursor=` — история ИИ‑анализов
  - Анализы сохраняются в таблицу `AIAnalysis` при вызове `/api/trades/analysis/period`
  - `response` и `metadata` хранятся как JSON‑строки (SQLite)

## Анализ периода (ИИ)
- `POST /api/trades/analysis/period`
  - Тело запроса:
    - `from`, `to` — ISO даты
    - `symbols: string[]`
    - `timespan`: `day` | `hour` | `minute` (ограничения периода: minute ≤ 7 дн, hour ≤ 30 дн, day ≤ 365 дн)
    - `trades?: TradeRecord[]` — необязательно; если передать ровно одну сделку с `id`, связка сохранится в `AIAnalysis.tradeId`
    - `includeRaw?: boolean` — при `true` вернёт свечи в ответе
  - Ответ:
    - `textSummary` — текстовый вывод ИИ (RU) или fallback‑сообщение
    - `structuredInsights` — JSON со сводной структурой периода
    - `candles?` — при `includeRaw=true`
    - `analysisId` — идентификатор сохранённого анализа в БД

Примечание: если `GEMINI_API_KEY` не задан или возникла ошибка, возвращается безопасный fallback‑текст, а структура периода всё равно сохраняется в `AIAnalysis` с `model: "none"`.

## Метрики
- `GET /api/metrics/summary?symbol=&from=&to=` — сводка
  - Возвращает: `tradesCount`, `wins`, `winRate`, `totalProfit`, `avgProfit`, `avgHoldTime`
- `GET /api/metrics/pnl/weekly?symbol=&from=&to=` — PnL по неделям (ISO)
  - Возвращает: `items[]` с `{ year, week, totalProfit, trades }`
- `GET /api/metrics/pnl/daily?symbol=&from=&to=` — PnL по дням (UTC)
  - Возвращает: `items[]` с `{ date, totalProfit, trades }`
- `GET /api/metrics/drawdown?symbol=&from=&to=` — максимальная просадка
  - Возвращает: `maxDrawdown`, `maxDrawdownPct`, `points[]` (equity/ДД во времени)

## Структура
- `src/index.ts` — инициализация Express, роутинг и middleware
- `src/config/index.ts` — конфигурация из `.env`
- `src/middleware/auth.middleware.ts` — защита API (заголовок `x-api-key`)
- `src/middleware/error.middleware.ts` — централизованная обработка ошибок
- `src/middleware/validation.middleware.ts` — валидация запросов
- `src/routes/trading.routes.ts` — торговые маршруты (`/api/trades/*`)
- `src/routes/db.routes.ts` — маршруты CRUD/аудита БД (`/api/db/*`)
- `src/routes/metrics.routes.ts` — маршруты метрик (`/api/metrics/*`)
- `src/controllers/trading.controller.ts` — OHLC, анализ периода, заглушки сделок/портфеля
- `src/controllers/db.controller.ts` — CRUD по сделкам, аудит и история анализов
- `src/controllers/metrics.controller.ts` — сводка, PnL weekly/daily, просадка
- `src/services/polygon.service.ts` — интеграция Polygon (агрегаты, ретраи, кэш)
- `src/services/gemini.service.ts` — вызовы Gemini (JSON‑приоритет, fallback)
- `src/services/news.service.ts` — интеграция с NewsAPI и сбор дайджестов
- `src/services/prisma.ts` — инициализация Prisma Client
- `src/utils/symbol-mapper.ts` — маппинг символов в формат Polygon
- `src/utils/indicators.ts` — базовые индикаторы/сводки по свечам
- `src/utils/validation.ts` — вспомогательные валидаторы
- `src/types/*` — типы домена и API

## Лицензия
ISC

