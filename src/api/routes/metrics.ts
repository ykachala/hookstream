import { Router, Request, Response } from 'express';
import { registry, queueDepth } from '@/metrics/registry';
import { deliveryQueue } from '@/queue/queues';

export const metricsRouter = Router();

metricsRouter.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const counts = await deliveryQueue.getJobCounts('waiting', 'active', 'delayed');
    queueDepth.set((counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0));
  } catch {
    // Non-fatal: metrics still served even if queue is unreachable
  }
  const metrics = await registry.metrics();
  res.set('Content-Type', registry.contentType);
  res.end(metrics);
});
