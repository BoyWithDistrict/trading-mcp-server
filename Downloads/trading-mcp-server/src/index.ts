import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createLogger, format, transports } from 'winston';
import { authenticate, requestLogger } from './middleware/auth.middleware';
import tradingRoutes from './routes/trading.routes';
import dbRoutes from './routes/db.routes';
import metricsRoutes from './routes/metrics.routes';
import adminRoutes from './routes/admin.routes';

// Загружаем переменные окружения
dotenv.config();

// Загружаем переменные окружения
dotenv.config();

// Инициализируем логгер
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'trading-mcp-server' },
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Создаем экземпляр приложения
const app = express();
const PORT = process.env.PORT || 3001;

// Настройка CORS
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000', // URL вашего веб-приложения
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key'],
  credentials: true
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

// Защищенные маршруты
app.use('/api', authenticate);

// Маршруты
app.use('/api/trades', tradingRoutes);
app.use('/api/db', dbRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/admin', adminRoutes);

// Проверка работоспособности
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Обработка 404
app.use((req, res) => {
  logger.warn(`Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Глобальный обработчик ошибок
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Запуск сервера
const server = app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});

// Обработка непредвиденных ошибок
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Обработка завершения работы
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully');
  server.close(() => {
    logger.info('Process terminated');
  });
});

export default app;