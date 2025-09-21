import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';

let prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
    // Пробный запрос к БД для ранней инициализации/логирования ошибок
    prisma.$connect()
      .then(() => logger.info('Prisma connected'))
      .catch((e) => {
        logger.error('Prisma connection error', { error: String(e) });
        throw e;
      });

    // Middleware аудита (MVP): пишем записи об изменениях основных моделей
    prisma.$use(async (params, next) => {
      const monitored = new Set(['Trade', 'TradePlan', 'AIAnalysis', 'Folder', 'Screenshot']);
      const actions = new Set(['create', 'update', 'delete']);
      const isMonitored = monitored.has(params.model || '');
      const isAction = actions.has(params.action);

      // Выполняем основную операцию и получаем результат
      const result = await next(params);

      try {
        if (isMonitored && isAction) {
          const entityType = params.model as string;
          // Пытаемся определить ID
          let entityId: string | null = null;
          if (result && typeof result === 'object' && 'id' in result) {
            entityId = String((result as any).id);
          } else if (params.args?.where?.id) {
            entityId = String(params.args.where.id);
          }

          // Гарантируем наличие demo user
          const demo = await prisma!.user.upsert({
            where: { email: 'demo@local' },
            update: {},
            create: { email: 'demo@local', name: 'Demo' },
            select: { id: true },
          });

          await prisma!.auditLog.create({
            data: {
              userId: demo.id,
              entityType,
              entityId: entityId || 'unknown',
              action: params.action,
              before: null,
              after: result ? JSON.stringify(result) : null,
            },
          });
        }
      } catch (e) {
        logger.warn('Audit middleware error (non-fatal)', { error: String(e) });
      }

      return result;
    });
  }
  return prisma;
}

export default getPrisma();
