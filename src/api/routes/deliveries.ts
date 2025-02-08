import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '@/api/middleware/auth';
import { DeliveryRepository, DeliveryStatus } from '@/db/repositories/DeliveryRepository';
import { SubscriberRepository } from '@/db/repositories/SubscriberRepository';
import { EventRepository } from '@/db/repositories/EventRepository';
import { enqueueDelivery } from '@/queue/producers';
import type { Tenant } from '@/db/repositories/TenantRepository';

const deliveryRepo = new DeliveryRepository();
const subscriberRepo = new SubscriberRepository();
const eventRepo = new EventRepository();

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
      ...(status !== undefined && { status: status as DeliveryStatus }),
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

deliveriesRouter.post('/:id/replay', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = res.locals['tenant'] as Tenant;
    const delivery = await deliveryRepo.findById(req.params['id']!, tenant.id);

    if (!delivery || delivery.status !== 'dead_letter') {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    await deliveryRepo.update(delivery.id, {
      status: 'pending',
      error: null,
      nextAttemptAt: new Date(),
    });

    const [subscriber, event] = await Promise.all([
      subscriberRepo.findById(delivery.subscriberId, tenant.id),
      eventRepo.findById(delivery.eventId, tenant.id),
    ]);

    if (!subscriber || !event) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    await enqueueDelivery({
      deliveryId: delivery.id,
      eventId: event.id,
      subscriberId: subscriber.id,
      tenantId: tenant.id,
      url: subscriber.url,
      secret: subscriber.secret,
      payload: event.payload,
      eventType: event.eventType,
    });

    res.json({ success: true, message: 'Delivery re-enqueued' });
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
