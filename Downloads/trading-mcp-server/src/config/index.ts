import dotenv from 'dotenv';

dotenv.config();

const config = {
  // Настройки сервера
  server: {
    port: process.env.PORT || 3001,
    env: process.env.NODE_ENV || 'development',
  },
  
  // Настройки логгера
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    file: {
      error: 'logs/error.log',
      combined: 'logs/combined.log',
    },
  },
  
  // Безопасность/доступы
  security: {
    apiKey: process.env.API_KEY || 'your-super-secret-key',
  },
  
  // Настройки CORS
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
  
  // API ключи и внешние сервисы
  api: {
    gemini: {
      // Поддерживаем обе переменные окружения для совместимости
      apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '',
      // Выбор модели через переменную окружения (по умолчанию быстрая и экономичная модель)
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      // Необязательная запасная модель при ошибке 400/прочих ошибках совместимости
      fallbackModel: process.env.GEMINI_FALLBACK_MODEL || 'gemini-1.5-flash',
      // Опциональный прокси только для Gemini (HTTP/HTTPS)
      proxyUrl: process.env.GEMINI_PROXY_URL || '',
      // Ограничение времени ожидания ответа модели (мс)
      timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS || 20000),
    },
    polygon: {
      apiKey: process.env.POLYGON_API_KEY || '',
      proxyUrl: process.env.POLYGON_PROXY_URL || '',
      s3: {
        accessKeyId: process.env.POLYGON_S3_ACCESS_KEY || '',
        secretAccessKey: process.env.POLYGON_S3_SECRET || '',
        endpoint: process.env.POLYGON_S3_ENDPOINT || 'https://files.polygon.io',
        bucket: process.env.POLYGON_S3_BUCKET || 'flatfiles',
      },
      defaults: {
        forexPrefix: 'C:',
        requestTimeoutMs: Number(process.env.POLYGON_TIMEOUT_MS || 15000),
        cacheTtlMs: Number(process.env.POLYGON_CACHE_TTL_MS || 10 * 60 * 1000),
        ttlByTimespanMinuteMs: Number(process.env.POLYGON_TTL_MINUTE_MS || 60 * 60 * 1000),
        ttlByTimespanHourMs: Number(process.env.POLYGON_TTL_HOUR_MS || 6 * 60 * 60 * 1000),
        ttlByTimespanDayMs: Number(process.env.POLYGON_TTL_DAY_MS || 24 * 60 * 60 * 1000),
        maxRetries: Number(process.env.POLYGON_MAX_RETRIES || 3),
        backoffBaseMs: Number(process.env.POLYGON_BACKOFF_BASE_MS || 300),
      }
    },
    news: {
      newsApiKey: process.env.NEWSAPI_KEY || '',
      defaults: {
        language: process.env.NEWSAPI_LANGUAGE || 'en',
        maxPerSymbol: Number(process.env.NEWSAPI_MAX_PER_SYMBOL || 5),
        timeoutMs: Number(process.env.NEWSAPI_TIMEOUT_MS || 15000),
      },
      enabled: String(process.env.NEWSAPI_ENABLED || 'true').toLowerCase() !== 'false',
      proxyUrl: process.env.NEWS_PROXY_URL || '',
    },
    // Добавьте другие API ключи по мере необходимости
  },
} as const;

export default config;

