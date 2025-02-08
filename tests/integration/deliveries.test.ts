import crypto from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { faker } from '@faker-js/faker';
import * as dbClient from '@/db/client';
import { runMigrations } from '@/db/migrations/runner';
import { TenantRepository } from '@/db/repositories/TenantRepository';
import { SubscriberRepository } from '@/db/repositories/SubscriberRepository';
import { EventRepository } from '@/db/repositories/EventRepository';
import { DeliveryRepository } from '@/db/repositories/DeliveryRepository';
import { createApp } from '@/api/server';
import { loadConfig } from '@/config';
import { factory } from '../helpers/factory';

const mockEnqueueDelivery = jest.fn().mockResolvedValue(undefined);

jest.mock('@/queue/producers', () => ({
  enqueueDelivery: (...args: unknown[]) => mockEnqueueDelivery(...args),
}));

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (TEST_DB_URL) process.env['DATABASE_URL'] = TEST_DB_URL;
if (!process.env['REDIS_URL']) process.env['REDIS_URL'] = 'redis://localhost:6379';

describe('deliveries API', () => {
  let pool: Pool;
  let tenantApiKey: string;
  let tenantApiKey2: string;
  let tenantId1: string;
  let app: ReturnType<typeof createApp>;

  const tenantRepo = new TenantRepository();
  const subscriberRepo = new SubscriberRepository();
  const eventRepo = new EventRepository();
  const deliveryRepo = new DeliveryRepository();

  beforeAll(async () => {
    if (!TEST_DB_URL) {
      throw new Error('TEST_DATABASE_URL env var is required for integration tests');
    }

    pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });
    await pool.query('SELECT 1');

    jest.spyOn(dbClient, 'getPool').mockReturnValue(pool);

    await runMigrations();

    const config = loadConfig();
    app = createApp(config);

    tenantApiKey = factory.apiKey();
    const hash1 = crypto.createHash('sha256').update(tenantApiKey).digest('hex');
    const tenant1 = await tenantRepo.create(factory.tenantName(), hash1);
    tenantId1 = tenant1.id;

    tenantApiKey2 = factory.apiKey();
    const hash2 = crypto.createHash('sha256').update(tenantApiKey2).digest('hex');
    await tenantRepo.create(factory.tenantName(), hash2);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await pool?.end();
  });

  beforeEach(() => {
    mockEnqueueDelivery.mockClear();
  });

  async function createSubscriberAndDelivery() {
    const secret = faker.string.hexadecimal({ length: 64, casing: 'lower', prefix: '' });
    const subscriber = await subscriberRepo.create(tenantId1, factory.url(), [factory.eventType()], secret);
    const event = await eventRepo.create(tenantId1, factory.eventType(), { key: faker.word.noun() });
    const delivery = await deliveryRepo.create(event.id, subscriber.id, tenantId1);
    return { subscriber, event, delivery };
  }

  // ──────────────────────────────────────────────
  // GET /api/v1/deliveries
  // ──────────────────────────────────────────────

  it('returns 401 without auth header', async () => {
    const res = await request(app).get('/api/v1/deliveries');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns empty array when no deliveries exist for the tenant', async () => {
    const freshKey = factory.apiKey();
    const freshHash = crypto.createHash('sha256').update(freshKey).digest('hex');
    await tenantRepo.create(factory.tenantName(), freshHash);

    const res = await request(app)
      .get('/api/v1/deliveries')
      .set('Authorization', `Bearer ${freshKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  it('returns deliveries for the tenant', async () => {
    await createSubscriberAndDelivery();

    const res = await request(app)
      .get('/api/v1/deliveries')
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta).toMatchObject({ limit: 20, offset: 0 });
  });

  it('filters deliveries by status=pending', async () => {
    await createSubscriberAndDelivery();

    const res = await request(app)
      .get('/api/v1/deliveries?status=pending')
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(res.status).toBe(200);
    for (const d of res.body.data) {
      expect(d.status).toBe('pending');
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/v1/deliveries/dead-letter
  // ──────────────────────────────────────────────

  it('GET /dead-letter returns only dead_letter items', async () => {
    const { delivery } = await createSubscriberAndDelivery();
    await deliveryRepo.markDeadLetter(delivery.id, 'test error');

    const res = await request(app)
      .get('/api/v1/deliveries/dead-letter')
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    for (const d of res.body.data) {
      expect(d.status).toBe('dead_letter');
    }
    const ids = (res.body.data as { id: string }[]).map((d) => d.id);
    expect(ids).toContain(delivery.id);
  });

  // ──────────────────────────────────────────────
  // GET /api/v1/deliveries/:id
  // ──────────────────────────────────────────────

  it('returns 404 for unknown delivery id', async () => {
    const res = await request(app)
      .get(`/api/v1/deliveries/${faker.string.uuid()}`)
      .set('Authorization', `Bearer ${tenantApiKey}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when another tenant tries to access a delivery (tenant isolation)', async () => {
    const { delivery } = await createSubscriberAndDelivery();

    const res = await request(app)
      .get(`/api/v1/deliveries/${delivery.id}`)
      .set('Authorization', `Bearer ${tenantApiKey2}`);

    expect(res.status).toBe(404);
  });

  // ──────────────────────────────────────────────
  // POST /api/v1/deliveries/:id/replay
  // ──────────────────────────────────────────────

  it('returns 404 when replaying a non-dead_letter delivery', async () => {
    const { delivery } = await createSubscriberAndDelivery();

    const res = await request(app)
      .post(`/api/v1/deliveries/${delivery.id}/replay`)
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(res.status).toBe(404);
    expect(mockEnqueueDelivery).not.toHaveBeenCalled();
  });

  it('re-enqueues a dead_letter delivery and calls enqueueDelivery', async () => {
    const { delivery, subscriber, event } = await createSubscriberAndDelivery();
    await deliveryRepo.markDeadLetter(delivery.id, 'endpoint down');

    const res = await request(app)
      .post(`/api/v1/deliveries/${delivery.id}/replay`)
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'Delivery re-enqueued' });

    expect(mockEnqueueDelivery).toHaveBeenCalledTimes(1);
    expect(mockEnqueueDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: delivery.id,
        eventId: event.id,
        subscriberId: subscriber.id,
        tenantId: tenantId1,
        url: subscriber.url,
      }),
    );

    const updated = await deliveryRepo.findById(delivery.id, tenantId1);
    expect(updated?.status).toBe('pending');
  });
});
