import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export class BaseController {
  /**
   * Обработка успешного ответа
   */
  protected handleSuccess(res: Response, data: any, statusCode: number = 200) {
    logger.info(`Success: ${statusCode}`, { data });
    return res.status(statusCode).json({
      success: true,
      data,
    });
  }

  /**
   * Обработка ошибок
   */
  protected handleError(
    res: Response, 
    error: Error | string | any, 
    statusCode: number = 500
  ) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        error: error.message || 'Ошибка валидации',
        errors: error.errors || error.details || {}
      });
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error ${statusCode}: ${errorMessage}`, { error });
    
    return res.status(statusCode).json({
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'Произошла ошибка на сервере' 
        : errorMessage,
      ...(process.env.NODE_ENV === 'development' && 
        error instanceof Error && 
        { stack: error.stack }),
    });
  }

  /**
   * Обработчик асинхронных методов контроллера
   */
  protected asyncHandler(fn: Function) {
    return (req: Request, res: Response, next: NextFunction) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }

  /**
   * Обработка ошибок валидации
   */
  protected handleValidationError(res: Response, errors: any[]) {
    return this.handleError(res, {
      name: 'ValidationError',
      message: 'Ошибка валидации',
      errors,
    }, 400);
  }
}
