# trading-mcp-server

MCP-сервер для приложения Trading Journal. Позволяет ИИ-ассистенту получать рыночные данные (Polygon.io) и выполнять анализ сделок пользователя.

## Возможности (MVP)
- Получение OHLC (Aggregates v2) для форекс/CFD тикеров через Polygon.io
- Анализ периода: подтягивает свечи по символам/сделкам и вызывает Gemini для текстового резюме и структурированных инсайтов
- Нормализация символов журнала в формат Polygon (EURUSD → C:EURUSD, XAUUSD+ → C:XAUUSD, USOUSD → C:XTIUSD)
- Ретраи, таймауты, базовый кэш ответов
- Аутентификация по API-ключу (заголовок `x-api-key`)

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
- `CORS_ORIGIN` — разрешённый источник CORS
- `DATABASE_URL` — строка подключения Prisma (для SQLite: `file:./prisma/dev.db`)
- Необязательные настройки Polygon:
  - `POLYGON_TIMEOUT_MS` (по умолчанию 15000)
  - `POLYGON_MAX_RETRIES` (по умолчанию 3)
  - `POLYGON_BACKOFF_BASE_MS` (по умолчанию 300)
  - `POLYGON_CACHE_TTL_MS` (по умолчанию 600000)
- Прокси (если используете VPN/корпоративную сеть):
  - `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`

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

## Полезные скрипты
- `npm run dev` — запуск сервера в dev-режиме
- `npm run build` — сборка TypeScript в `dist/`
- `npm start` — запуск собранного кода
- `npm run prisma:generate` — генерация Prisma Client
- `npm run prisma:migrate` — миграция схемы (создаст/обновит файл БД)

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
- `src/services/polygon.service.ts` — интеграция Polygon (агрегаты, ретраи, кэш)
- `src/services/gemini.service.ts` — вызовы Gemini
- `src/controllers/trading.controller.ts` — контроллеры (OHLC, анализ)
- `src/routes/trading.routes.ts` — маршруты
- `src/utils/symbol-mapper.ts` — маппинг символов в формат Polygon
- `src/config/index.ts` — конфигурация

## Лицензия
ISC
