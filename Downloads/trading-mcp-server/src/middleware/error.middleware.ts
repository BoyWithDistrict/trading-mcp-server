import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

class ErrorHandler extends Error {
  statusCode: number;
  
  constructor(statusCode: number, message: string) {
    super();
    this.statusCode = statusCode;
    this.message = message;
  }
}

export const errorHandler = (
  err: ErrorHandler,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Внутренняя ошибка сервера';

  logger.error({
    statusCode,
    message,
    path: req.originalUrl,
    method: req.method,
    stack: process.env.NODE_ENV === 'development' ? err.stack : {}
  });

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

export const notFound = (req: Request, res: Response, next: NextFunction) => {
  const error = new ErrorHandler(404, `Not Found - ${req.originalUrl}`);
  next(error);
};

export default {
  ErrorHandler,
  errorHandler,
  notFound
};
