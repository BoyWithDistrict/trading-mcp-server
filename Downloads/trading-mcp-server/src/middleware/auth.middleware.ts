import { Request, Response, NextFunction } from 'express';
import { BaseController } from '../controllers/base.controller';
import config from '../config';

const baseController = new BaseController();
const API_KEY = config.security.apiKey; // Берем из .env через конфиг

/**
 * Простая проверка API ключа из заголовка
 */
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  
  if (apiKey === API_KEY) {
    return next();
  }
  
  return baseController.handleError(res, 'Неверный API ключ', 401);
};

/**
 * Middleware для логирования запросов
 */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
};
