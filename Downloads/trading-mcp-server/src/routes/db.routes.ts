import { Router } from 'express';
import dbController from '../controllers/db.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Защищаем все маршруты API ключом
router.use(authenticate);

// Trades
router.get('/trades', dbController.listTrades);
router.post('/trades', dbController.createTrade);
router.put('/trades/:id', dbController.updateTrade);
router.delete('/trades/:id', dbController.deleteTrade);

// Audit
router.get('/audit', dbController.listAudit);

// AI Analyses history
router.get('/analyses', dbController.listAnalyses);

export default router;
