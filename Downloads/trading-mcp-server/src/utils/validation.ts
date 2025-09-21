import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { BaseController } from '../controllers/base.controller';

const baseController = new BaseController();

export const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  
  if (errors.isEmpty()) {
    return next();
  }

  const extractedErrors: { [key: string]: string } = {};
  errors.array().forEach(err => {
    if (err.param) {
      extractedErrors[err.param] = err.msg;
    }
  });

  return baseController.handleError(
    res,
    {
      name: 'ValidationError',
      message: 'Ошибка валидации',
      errors: extractedErrors
    },
    400
  );
};

export const validateSymbol = (symbol: string) => {
  // Базовая валидация символа (можно расширить)
  return /^[A-Z0-9.-]+$/.test(symbol);
};

export const validateTimeframe = (timeframe: string) => {
  // Поддерживаемые таймфреймы
  const validTimeframes = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];
  return validTimeframes.includes(timeframe);
};
