import { Router, Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/auth';
import { SubscriberService } from '@/services/SubscriberService';
import { SubscriberRepository } from '@/db/repositories/SubscriberRepository';
import { Tenant } from '@/db/repositories/TenantRepository';

const repo = new SubscriberRepository();
const service = new SubscriberService(repo);

export const subscribersRouter = Router();

subscribersRouter.use(authMiddleware);

/** POST /api/v1/subscribers */
subscribersRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const { url, event_types } = req.body as { url?: unknown; event_types?: unknown };

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url is required and must be a string' });
    return;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with http:// or https://' });
    return;
  }
  if (!Array.isArray(event_types) || event_types.length === 0) {
    res.status(400).json({ error: 'event_types is required and must be a non-empty array' });
    return;
  }
  for (const et of event_types) {
    if (typeof et !== 'string') {
      res.status(400).json({ error: 'each event_type must be a string' });
      return;
    }
  }

  const { subscriber, secret } = await service.register(tenant.id, url, event_types as string[]);

  res.status(201).json({
    success: true,
    data: {
      id: subscriber.id,
      url: subscriber.url,
      event_types: subscriber.eventTypes,
      is_active: subscriber.isActive,
      is_verified: subscriber.isVerified,
      created_at: subscriber.createdAt,
      secret,
    },
    message: 'Subscriber registered successfully.',
  });
});

/** GET /api/v1/subscribers */
subscribersRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const subs = await service.list(tenant.id);
  res.status(200).json({
    success: true,
    data: subs.map((s) => ({
      id: s.id,
      url: s.url,
      event_types: s.eventTypes,
      is_active: s.isActive,
      is_verified: s.isVerified,
      created_at: s.createdAt,
    })),
    message: 'Subscribers retrieved successfully.',
  });
});

/** GET /api/v1/subscribers/:id */
subscribersRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const sub = await service.getById(req.params['id']!, tenant.id);
  if (!sub) {
    res.status(404).json({ error: 'Subscriber not found' });
    return;
  }
  res.status(200).json({
    success: true,
    data: {
      id: sub.id,
      url: sub.url,
      event_types: sub.eventTypes,
      is_active: sub.isActive,
      is_verified: sub.isVerified,
      created_at: sub.createdAt,
    },
    message: 'Subscriber retrieved successfully.',
  });
});

/** DELETE /api/v1/subscribers/:id */
subscribersRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const deleted = await service.remove(req.params['id']!, tenant.id);
  if (!deleted) {
    res.status(404).json({ error: 'Subscriber not found' });
    return;
  }
  res.status(204).send();
});

/** POST /api/v1/subscribers/:id/verify */
subscribersRouter.post('/:id/verify', async (req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const verified = await service.sendVerificationChallenge(req.params['id']!, tenant.id);
  if (!verified) {
    res.status(400).json({ error: 'Verification failed' });
    return;
  }
  res.status(200).json({ success: true, data: { verified: true }, message: 'Subscriber verified successfully.' });
});

/** PATCH /api/v1/subscribers/:id/pause */
subscribersRouter.patch('/:id/pause', async (req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const { paused } = req.body as { paused?: unknown };

  if (typeof paused !== 'boolean') {
    res.status(400).json({ error: 'paused must be a boolean' });
    return;
  }

  const sub = await service.setPaused(req.params['id']!, tenant.id, paused);
  if (!sub) {
    res.status(404).json({ error: 'Subscriber not found' });
    return;
  }
  res.status(200).json({
    success: true,
    data: {
      id: sub.id,
      url: sub.url,
      event_types: sub.eventTypes,
      is_active: sub.isActive,
      is_verified: sub.isVerified,
      created_at: sub.createdAt,
    },
    message: 'Subscriber updated successfully.',
  });
});
