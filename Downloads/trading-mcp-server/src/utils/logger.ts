import { createLogger, format, transports, Logger } from 'winston';
import config from '../config';

const { combine, timestamp, printf, colorize, json } = format;

// Кастомный формат логов для консоли
const consoleFormat = printf(({ level, message, timestamp, ...meta }) => {
  return `${timestamp} [${level}]: ${message} ${
    Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
  }`;
});

// Создаем логгер
const logger: Logger = createLogger({
  level: config.logger.level,
  format: combine(timestamp(), json()),
  transports: [
    // Запись ошибок в файл
    new transports.File({
      filename: config.logger.file.error,
      level: 'error',
    }),
    // Запись всех логов в файл
    new transports.File({
      filename: config.logger.file.combined,
    }),
  ],
  exitOnError: false,
});

// В режиме разработки добавляем вывод в консоль
if (config.server.env === 'development') {
  logger.add(
    new transports.Console({
      format: combine(colorize(), timestamp(), consoleFormat),
    })
  );
}

// Обертка для логирования ошибок
export const logError = (error: Error): void => {
  logger.error(error.message, { stack: error.stack });
};

export default logger;
