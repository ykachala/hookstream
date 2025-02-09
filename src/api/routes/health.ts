import { Router, Request, Response } from 'express';
import { checkDbHealth } from '@/db/client';
import { getRedisClient } from '@/queue/queues';

const router = Router();

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

router.get('/health/ready', async (_req: Request, res: Response): Promise<void> => {
  const [dbOk, redisOk] = await Promise.all([
    checkDbHealth().catch(() => false),
    getRedisClient().ping().then(() => true).catch(() => false),
  ]);
  const status = dbOk && redisOk ? 200 : 503;
  res.status(status).json({ db: dbOk, redis: redisOk });
});

export { router as healthRouter };
