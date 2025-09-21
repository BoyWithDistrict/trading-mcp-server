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
