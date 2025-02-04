/**
 * Integration tests for subscriber management API.
 *
 * Requires: TEST_DATABASE_URL env var pointing to a running PostgreSQL instance.
 * Run with: TEST_DATABASE_URL=... npm run test:integration
 */

import crypto from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { faker } from '@faker-js/faker';
import * as dbClient from '@/db/client';
import { runMigrations } from '@/db/migrations/runner';
import { TenantRepository } from '@/db/repositories/TenantRepository';
import { createApp } from '@/api/server';
import { loadConfig } from '@/config';
import { factory } from '../helpers/factory';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

// loadConfig() reads DATABASE_URL and REDIS_URL; set them from test env before calling it
if (TEST_DB_URL) process.env['DATABASE_URL'] = TEST_DB_URL;
if (!process.env['REDIS_URL']) process.env['REDIS_URL'] = 'redis://localhost:6379';

describe('subscribers API', () => {
  let pool: Pool;
  let tenantApiKey: string;
  let tenantApiKey2: string;
  let app: ReturnType<typeof createApp>;

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

    const tenantRepo = new TenantRepository();

    // Create tenant 1
    tenantApiKey = factory.apiKey();
    const hash1 = crypto.createHash('sha256').update(tenantApiKey).digest('hex');
    await tenantRepo.create(factory.tenantName(), hash1);

    // Create tenant 2 for isolation tests
    tenantApiKey2 = factory.apiKey();
    const hash2 = crypto.createHash('sha256').update(tenantApiKey2).digest('hex');
    await tenantRepo.create(factory.tenantName(), hash2);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await pool?.end();
  });

  // Helper to create a subscriber for tests that need one pre-existing
  async function createSubscriber(overrides?: { url?: string; event_types?: string[] }) {
    const res = await request(app)
      .post('/api/v1/subscribers')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({
        url: overrides?.url ?? factory.url(),
        event_types: overrides?.event_types ?? [factory.eventType()],
      });
    return res;
  }

  // ──────────────────────────────────────────────
  // POST /api/v1/subscribers
  // ──────────────────────────────────────────────

  it('returns 401 without auth header', async () => {
    const res = await request(app)
      .post('/api/v1/subscribers')
      .send({ url: factory.url(), event_types: [factory.eventType()] });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'Unauthorized' });
  });

  it('returns 201 with valid auth and includes secret in response', async () => {
    const url = factory.url();
    const eventType = factory.eventType();
    const res = await request(app)
      .post('/api/v1/subscribers')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ url, event_types: [eventType] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      url,
      event_types: [eventType],
      is_active: true,
      is_verified: false,
    });
    expect(typeof res.body.data.id).toBe('string');
    expect(typeof res.body.data.secret).toBe('string');
    expect(res.body.data.secret).toHaveLength(64); // 32 bytes hex
  });

  it('returns 400 when url does not start with http/https', async () => {
    const res = await request(app)
      .post('/api/v1/subscribers')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ url: 'ftp://example.com/hooks', event_types: [factory.eventType()] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('http') });
  });

  it('returns 400 when url is missing', async () => {
    const res = await request(app)
      .post('/api/v1/subscribers')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ event_types: [factory.eventType()] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when event_types is missing', async () => {
    const res = await request(app)
      .post('/api/v1/subscribers')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ url: factory.url() });
    expect(res.status).toBe(400);
  });

  it('returns 400 when event_types is empty array', async () => {
    const res = await request(app)
      .post('/api/v1/subscribers')
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ url: factory.url(), event_types: [] });
    expect(res.status).toBe(400);
  });

  // ──────────────────────────────────────────────
  // GET /api/v1/subscribers
  // ──────────────────────────────────────────────

  it('returns array of subscribers without secret field', async () => {
    await createSubscriber();

    const res = await request(app)
      .get('/api/v1/subscribers')
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    // secret must never appear in list response
    for (const sub of res.body.data) {
      expect(sub).not.toHaveProperty('secret');
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/v1/subscribers/:id
  // ──────────────────────────────────────────────

  it('returns 404 for unknown subscriber id', async () => {
    const fakeId = faker.string.uuid();
    const res = await request(app)
      .get(`/api/v1/subscribers/${fakeId}`)
      .set('Authorization', `Bearer ${tenantApiKey}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for another tenant\'s subscriber (tenant isolation)', async () => {
    // Create subscriber as tenant 1
    const createRes = await createSubscriber();
    expect(createRes.status).toBe(201);
    const subId = createRes.body.data.id as string;

    // Try to access it as tenant 2
    const res = await request(app)
      .get(`/api/v1/subscribers/${subId}`)
      .set('Authorization', `Bearer ${tenantApiKey2}`);
    expect(res.status).toBe(404);
  });

  it('returns subscriber without secret for own tenant', async () => {
    const url = factory.url();
    const createRes = await createSubscriber({ url });
    const subId = createRes.body.data.id as string;

    const res = await request(app)
      .get(`/api/v1/subscribers/${subId}`)
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe(url);
    expect(res.body.data).not.toHaveProperty('secret');
  });

  // ──────────────────────────────────────────────
  // DELETE /api/v1/subscribers/:id
  // ──────────────────────────────────────────────

  it('returns 204 on successful delete', async () => {
    const createRes = await createSubscriber();
    const subId = createRes.body.data.id as string;

    const res = await request(app)
      .delete(`/api/v1/subscribers/${subId}`)
      .set('Authorization', `Bearer ${tenantApiKey}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 on repeat delete', async () => {
    const createRes = await createSubscriber();
    const subId = createRes.body.data.id as string;

    await request(app)
      .delete(`/api/v1/subscribers/${subId}`)
      .set('Authorization', `Bearer ${tenantApiKey}`);

    const res = await request(app)
      .delete(`/api/v1/subscribers/${subId}`)
      .set('Authorization', `Bearer ${tenantApiKey}`);
    expect(res.status).toBe(404);
  });

  // ──────────────────────────────────────────────
  // PATCH /api/v1/subscribers/:id/pause
  // ──────────────────────────────────────────────

  it('paused=true sets is_active to false', async () => {
    const createRes = await createSubscriber();
    expect(createRes.body.data.is_active).toBe(true);
    const subId = createRes.body.data.id as string;

    const res = await request(app)
      .patch(`/api/v1/subscribers/${subId}/pause`)
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ paused: true });

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  it('paused=false sets is_active to true', async () => {
    const createRes = await createSubscriber();
    const subId = createRes.body.data.id as string;

    // First pause it
    await request(app)
      .patch(`/api/v1/subscribers/${subId}/pause`)
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ paused: true });

    // Then unpause
    const res = await request(app)
      .patch(`/api/v1/subscribers/${subId}/pause`)
      .set('Authorization', `Bearer ${tenantApiKey}`)
      .send({ paused: false });

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(true);
  });

  // ──────────────────────────────────────────────
  // POST /api/v1/subscribers/:id/rotate-secret
  // ──────────────────────────────────────────────

  it('rotate-secret returns a new secret different from the original', async () => {
    const createRes = await createSubscriber();
    const subId = createRes.body.data.id as string;
    const originalSecret = createRes.body.data.secret as string;

    const rotateRes = await request(app)
      .post(`/api/v1/subscribers/${subId}/rotate-secret`)
      .set('Authorization', `Bearer ${tenantApiKey}`);

    expect(rotateRes.status).toBe(200);
    expect(typeof rotateRes.body.data.secret).toBe('string');
    expect(rotateRes.body.data.secret).toHaveLength(64);
    expect(rotateRes.body.data.secret).not.toBe(originalSecret);
  });
});

