import request from 'supertest';
import { createApp } from '@/api/server';
import { loadConfig } from '@/config';

if (!process.env['DATABASE_URL']) process.env['DATABASE_URL'] = 'postgresql://hookstream:hookstream@localhost:5432/hookstream_test';
if (!process.env['REDIS_URL']) process.env['REDIS_URL'] = 'redis://localhost:6379';

const mockPing = jest.fn();
const mockGetJobCounts = jest.fn();
const mockCheckDbHealth = jest.fn();

jest.mock('@/queue/queues', () => ({
  getRedisClient: () => ({ ping: (...args: unknown[]) => mockPing(...args) }),
  deliveryQueue: { getJobCounts: (...args: unknown[]) => mockGetJobCounts(...args) },
}));

jest.mock('@/db/client', () => ({
  checkDbHealth: (...args: unknown[]) => mockCheckDbHealth(...args),
  getPool: jest.fn(),
}));

describe('observability endpoints', () => {
  const app = createApp(loadConfig());

  beforeEach(() => {
    mockPing.mockReset();
    mockGetJobCounts.mockReset();
    mockCheckDbHealth.mockReset();
  });

  describe('GET /health', () => {
    it('returns 200 with status and uptime', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });
      expect(typeof res.body.uptime).toBe('number');
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 when both DB and Redis are healthy', async () => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockPing.mockResolvedValue('PONG');

      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ db: true, redis: true });
    });

    it('returns 503 when DB is down', async () => {
      mockCheckDbHealth.mockRejectedValue(new Error('connection refused'));
      mockPing.mockResolvedValue('PONG');

      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ db: false, redis: true });
    });

    it('returns 503 when Redis is down', async () => {
      mockCheckDbHealth.mockResolvedValue(true);
      mockPing.mockRejectedValue(new Error('ECONNREFUSED'));

      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ db: true, redis: false });
    });
  });

  describe('GET /metrics', () => {
    it('returns 200 with Prometheus text format containing metric names', async () => {
      mockGetJobCounts.mockResolvedValue({ waiting: 3, active: 1, delayed: 0 });

      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      expect(res.text).toContain('hookstream_deliveries_total');
    });

    it('still returns metrics even when queue is unreachable', async () => {
      mockGetJobCounts.mockRejectedValue(new Error('Redis unavailable'));

      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('hookstream_deliveries_total');
    });
  });
});
