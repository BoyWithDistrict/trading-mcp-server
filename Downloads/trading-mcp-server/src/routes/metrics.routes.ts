import { Router } from 'express';
import metricsController from '../controllers/metrics.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/summary', metricsController.summary);
router.get('/pnl/weekly', metricsController.pnlWeekly);
router.get('/pnl/daily', metricsController.pnlDaily);
router.get('/drawdown', metricsController.drawdown);

export default router;
