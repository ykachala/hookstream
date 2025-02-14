import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '@/api/middleware/auth';
import { DeliveryRepository, DeliveryStatus } from '@/db/repositories/DeliveryRepository';
import { SubscriberRepository } from '@/db/repositories/SubscriberRepository';
import { EventRepository } from '@/db/repositories/EventRepository';
import { enqueueDelivery } from '@/queue/producers';
import { loadConfig } from '@/config/index';
import { diagnoseEndpointFailures } from '@/ai/diagnostics';
import type { Tenant } from '@/db/repositories/TenantRepository';

const deliveryRepo = new DeliveryRepository();
const subscriberRepo = new SubscriberRepository();
const eventRepo = new EventRepository();

export const deliveriesRouter = Router();

deliveriesRouter.use(authMiddleware);

// POST /diagnose must be registered before /:id to avoid the param catching "diagnose"
deliveriesRouter.post('/diagnose', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const config = loadConfig();
    if (!config.anthropicApiKey) {
      res.status(501).json({ error: 'AI diagnostics not enabled — set ANTHROPIC_API_KEY' });
      return;
    }

    const tenant = res.locals['tenant'] as Tenant;
    const { subscriber_id, limit = 20 } = req.body as { subscriber_id?: string; limit?: number };

    if (!subscriber_id) {
      res.status(400).json({ error: 'subscriber_id is required' });
      return;
    }

    const subscriber = await subscriberRepo.findById(subscriber_id, tenant.id);
    if (!subscriber) {
      res.status(404).json({ error: 'Subscriber not found' });
      return;
    }

    const failures = await deliveryRepo.findRecentFailures(
      tenant.id,
      subscriber_id,
      Math.min(Number(limit) || 20, 50),
    );

    if (failures.length === 0) {
      res.json({ success: true, data: null, message: 'No recent failures for this endpoint.' });
      return;
    }

    const diagnosis = await diagnoseEndpointFailures(subscriber.url, failures, config.anthropicApiKey);
    res.json({ success: true, data: diagnosis });
  } catch (err) {
    next(err);
  }
});

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
