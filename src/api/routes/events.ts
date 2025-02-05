import { Router, Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/auth';
import { EventService } from '@/services/EventService';
import { EventRepository } from '@/db/repositories/EventRepository';
import { SubscriberRepository } from '@/db/repositories/SubscriberRepository';
import { DeliveryRepository } from '@/db/repositories/DeliveryRepository';
import { Tenant } from '@/db/repositories/TenantRepository';

const eventRepo = new EventRepository();
const subscriberRepo = new SubscriberRepository();
const deliveryRepo = new DeliveryRepository();
const service = new EventService(eventRepo, subscriberRepo, deliveryRepo);

export const eventsRouter = Router();

eventsRouter.use(authMiddleware);

/** POST /api/v1/events */
eventsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const { event_type, payload } = req.body as { event_type?: unknown; payload?: unknown };

  if (!event_type || typeof event_type !== 'string') {
    res.status(400).json({ error: 'event_type is required and must be a string' });
    return;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ error: 'payload is required and must be an object' });
    return;
  }

  const { eventId, enqueuedCount } = await service.ingest(
    tenant.id,
    event_type,
    payload as Record<string, unknown>,
  );

  res.status(202).json({
    success: true,
    data: { event_id: eventId, enqueued_count: enqueuedCount },
    message: 'Event ingested successfully.',
  });
});

/** GET /api/v1/events/:id */
eventsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const event = await service.getEvent(req.params['id']!, tenant.id);

  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  const deliveries = await deliveryRepo.findByEventId(event.id, tenant.id);

  res.status(200).json({
    success: true,
    data: {
      id: event.id,
      event_type: event.eventType,
      payload: event.payload,
      created_at: event.createdAt,
      deliveries: deliveries.map((d) => ({
        id: d.id,
        subscriber_id: d.subscriberId,
        status: d.status,
        attempt_count: d.attemptCount,
        last_attempt_at: d.lastAttemptAt,
        created_at: d.createdAt,
      })),
    },
    message: 'Event retrieved successfully.',
  });
});
