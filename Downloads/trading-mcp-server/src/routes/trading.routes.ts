import { Router } from 'express';
import tradingController from '../controllers/trading.controller';
import { query, body } from 'express-validator';
import { validate } from '../utils/validation';

const router = Router();

// Получение списка сделок
router.get('/trades', tradingController.getTrades);

// Добавление новой сделки
router.post('/trades', tradingController.addTrade);

// Получение рыночных данных
router.get('/market', tradingController.getMarketData);

// Получение OHLC (агрегатов) с Polygon
router.get(
  '/market/ohlc',
  [
    query('symbol').isString().trim().notEmpty().withMessage('symbol is required'),
    query('from').isISO8601().withMessage('from must be ISO date'),
    query('to').isISO8601().withMessage('to must be ISO date'),
    query('timespan')
      .optional()
      .isIn(['minute', 'hour', 'day'])
      .withMessage("timespan must be one of: minute | hour | day"),
  ],
  validate,
  tradingController.getMarketOHLC
);

// Анализ периода по сделкам/символам
router.post(
  '/analysis/period',
  [
    body('from').isISO8601().withMessage('from is required (ISO date)'),
    body('to').isISO8601().withMessage('to is required (ISO date)'),
    body('timespan')
      .optional()
      .isIn(['minute', 'hour', 'day'])
      .withMessage("timespan must be one of: minute | hour | day"),
    body('symbols')
      .optional()
      .isArray()
      .withMessage('symbols must be an array of strings'),
    body('trades')
      .optional()
      .isArray()
      .withMessage('trades must be an array'),
    // Усиленная проверка элементов trades
    body('trades.*.symbol')
      .optional()
      .isString().trim().notEmpty().withMessage('trades[*].symbol must be non-empty string'),
    body('trades.*.price')
      .optional()
      .isFloat({ gt: 0 }).withMessage('trades[*].price must be > 0'),
    body('trades.*.amount')
      .optional()
      .isFloat({ gt: 0 }).withMessage('trades[*].amount must be > 0'),
    body('trades.*.entryTime')
      .optional()
      .isISO8601().withMessage('trades[*].entryTime must be ISO date'),
    body('trades.*.exitTime')
      .optional()
      .isISO8601().withMessage('trades[*].exitTime must be ISO date'),
    body('trades')
      .optional()
      .custom((arr) => {
        if (!Array.isArray(arr)) return true;
        for (const t of arr) {
          if (t && t.entryTime && t.exitTime) {
            const e = new Date(t.entryTime).getTime();
            const x = new Date(t.exitTime).getTime();
            if (!isFinite(e) || !isFinite(x) || e >= x) {
              throw new Error('trades[*].entryTime must be < exitTime when both provided');
            }
          }
        }
        return true;
      }),
  ],
  validate,
  tradingController.analyzePeriod
);

// Получение статистики портфеля
router.get('/portfolio', tradingController.getPortfolioStats);

export default router;
