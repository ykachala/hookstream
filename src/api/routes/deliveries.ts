import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '@/api/middleware/auth';
import { DeliveryRepository } from '@/db/repositories/DeliveryRepository';
import type { Tenant } from '@/db/repositories/TenantRepository';

const deliveryRepo = new DeliveryRepository();

export const deliveriesRouter = Router();

deliveriesRouter.use(authMiddleware);

deliveriesRouter.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = res.locals['tenant'] as Tenant;
    const limit = Math.min(parseInt((req.query['limit'] as string) ?? '20', 10) || 20, 100);
    const offset = parseInt((req.query['offset'] as string) ?? '0', 10) || 0;
    const status = req.query['status'] as string | undefined;
    const subscriberId = req.query['subscriber_id'] as string | undefined;

    const result = await deliveryRepo.findByTenantId(tenant.id, {
      limit,
      offset,
      ...(status !== undefined && { status: status as import('@/db/repositories/DeliveryRepository').DeliveryStatus }),
      ...(subscriberId !== undefined && { subscriberId }),
    });

    res.json({
      success: true,
      data: result.data,
      meta: { total: result.total, limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

deliveriesRouter.get('/dead-letter', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = res.locals['tenant'] as Tenant;
    const limit = Math.min(parseInt((req.query['limit'] as string) ?? '20', 10) || 20, 100);
    const offset = parseInt((req.query['offset'] as string) ?? '0', 10) || 0;

    const result = await deliveryRepo.findDeadLetter(tenant.id, limit, offset);

    res.json({
      success: true,
      data: result.data,
      meta: { total: result.total, limit, offset },
    });
  } catch (err) {
    next(err);
  }
});

deliveriesRouter.get('/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = res.locals['tenant'] as Tenant;
    const delivery = await deliveryRepo.findById(req.params['id']!, tenant.id);

    if (!delivery) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json({ success: true, data: delivery });
  } catch (err) {
    next(err);
  }
});
