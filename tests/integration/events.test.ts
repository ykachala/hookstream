import crypto from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { faker } from '@faker-js/faker';
import * as dbClient from '@/db/client';
import { runMigrations } from '@/db/migrations/runner';
import { TenantRepository } from '@/db/repositories/TenantRepository';
import { SubscriberRepository } from '@/db/repositories/SubscriberRepository';
import { createApp } from '@/api/server';
import { loadConfig } from '@/config';
import { factory } from '../helpers/factory';

jest.mock('@/queue/producers', () => ({
  enqueueDelivery: jest.fn().mockResolvedValue(undefined),
}));

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (TEST_DB_URL) process.env['DATABASE_URL'] = TEST_DB_URL;
if (!process.env['REDIS_URL']) process.env['REDIS_URL'] = 'redis://localhost:6379';

describe('events API', () => {
  let pool: Pool;
  let tenantApiKey: string;
  let tenantApiKey2: string;
  let tenantId1: string;
  let tenantId2: string;
  let app: ReturnType<typeof createApp>;

  const subscriberRepo = new SubscriberRepository();
  const tenantRepo = new TenantRepository();

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
    const tenant2 = await tenantRepo.create(factory.tenantName(), hash2);
    tenantId2 = tenant2.id;
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await pool?.end();
  });

  // ──────────────────────────────────────────────
  // POST /api/v1/events
  // ──────────────────────────────────────────────

  it('returns 401 without auth header', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .send({ event_type: factory.eventType(), payload: { key: faker.word.noun() } });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 400 when event_type is missing', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ payload: { key: faker.word.noun() } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when payload is not an object', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ event_type: factory.eventType(), payload: 'not-an-object' });
    expect(res.status).toBe(400);
  });

  it('returns 202 with event_id and enqueued_count when valid', async () => {
    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ event_type: factory.eventType(), payload: { key: faker.word.noun() } });
    expect(res.status).toBe(202);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.event_id).toBe('string');
    expect(typeof res.body.data.enqueued_count).toBe('number');
  });

  it('returns enqueued_count of 1 when a matching verified+active subscriber exists', async () => {
    const eventType = factory.eventType();
    const secret = faker.string.hexadecimal({ length: 64, casing: 'lower', prefix: '' });
    const sub = await subscriberRepo.create(tenantId1, factory.url(), [eventType], secret);
    await subscriberRepo.update(sub.id, tenantId1, { isVerified: true });

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ event_type: eventType, payload: { data: faker.word.noun() } });

    expect(res.status).toBe(202);
    expect(res.body.data.enqueued_count).toBe(1);
  });

  it('returns enqueued_count of 0 when no subscriber matches the event_type', async () => {
    const eventType = `nonexistent.${faker.string.alphanumeric(8)}`;

    const res = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ event_type: eventType, payload: { data: faker.word.noun() } });

    expect(res.status).toBe(202);
    expect(res.body.data.enqueued_count).toBe(0);
  });

  // ──────────────────────────────────────────────
  // GET /api/v1/events/:id
  // ──────────────────────────────────────────────

  it('returns 404 for unknown event id', async () => {
    const fakeId = faker.string.uuid();
    const res = await request(app)
      .get(`/api/v1/events/${fakeId}`)
      .set('Authorization', `Bearer ${tenantApiKey}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for another tenant\'s event (isolation)', async () => {
    const ingestRes = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ event_type: factory.eventType(), payload: { x: faker.word.noun() } });
    expect(ingestRes.status).toBe(202);
    const eventId = ingestRes.body.data.event_id as string;

    const res = await request(app)
      .get(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${tenantApiKey2}`);
    expect(res.status).toBe(404);
  });

  it('returns 200 with event details and deliveries array', async () => {
    const eventType = factory.eventType();
    const payload = { item: faker.word.noun() };

    const ingestRes = await request(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ event_type: eventType, payload });
    expect(ingestRes.status).toBe(202);
    const eventId = ingestRes.body.data.event_id as string;

    const res = await request(app)
      .get(`/api/v1/events/${eventId}`)
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(eventId);
    expect(res.body.data.event_type).toBe(eventType);
    expect(res.body.data.payload).toMatchObject(payload);
    expect(Array.isArray(res.body.data.deliveries)).toBe(true);
  });
});
