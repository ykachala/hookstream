import { Job } from 'bullmq';
import { faker } from '@faker-js/faker';
import { DeliveryJobData } from '@/queue/producers';
import { getBackoffDelay } from '@/workers/backoff';

const mockMarkDelivered = jest.fn().mockResolvedValue(undefined);
const mockMarkFailed = jest.fn().mockResolvedValue(undefined);
const mockMarkDeadLetter = jest.fn().mockResolvedValue(undefined);

jest.mock('@/db/repositories/DeliveryRepository', () => ({
  DeliveryRepository: jest.fn().mockImplementation(() => ({
    markDelivered: mockMarkDelivered,
    markFailed: mockMarkFailed,
    markDeadLetter: mockMarkDeadLetter,
  })),
}));

jest.mock('@/queue/queues', () => ({
  getRedisClient: jest.fn().mockReturnValue({}),
  deliveryQueue: {},
  initQueue: jest.fn(),
  closeQueue: jest.fn(),
}));

import { processDelivery } from '@/workers/deliveryWorker';

const makeJob = (overrides?: Partial<Job<DeliveryJobData>>): Job<DeliveryJobData> =>
  ({
    data: {
      deliveryId: faker.string.uuid(),
      eventId: faker.string.uuid(),
      subscriberId: faker.string.uuid(),
      tenantId: faker.string.uuid(),
      url: `https://${faker.internet.domainName()}/webhook`,
      secret: faker.string.alphanumeric(32),
      payload: { key: faker.word.noun() },
      eventType: `${faker.word.noun()}.${faker.word.verb()}`,
    },
    attemptsMade: 0,
    opts: { attempts: 5 },
    ...overrides,
  }) as unknown as Job<DeliveryJobData>;

describe('processDelivery', () => {
  let originalFetch: typeof fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    mockMarkDelivered.mockClear();
    mockMarkFailed.mockClear();
    mockMarkDeadLetter.mockClear();
  });

  it('calls markDelivered on a 2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue('ok'),
    });

    const job = makeJob();
    await processDelivery(job);

    expect(mockMarkDelivered).toHaveBeenCalledWith(job.data.deliveryId, 200, 'ok');
    expect(mockMarkFailed).not.toHaveBeenCalled();
    expect(mockMarkDeadLetter).not.toHaveBeenCalled();
  });

  it('calls markDeadLetter on final attempt with non-2xx response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: jest.fn().mockResolvedValue('Service Unavailable'),
    });

    const job = makeJob({ attemptsMade: 4, opts: { attempts: 5 } });
    await expect(processDelivery(job)).rejects.toThrow('HTTP 503');

    expect(mockMarkDeadLetter).toHaveBeenCalledWith(job.data.deliveryId, 'HTTP 503');
    expect(mockMarkDelivered).not.toHaveBeenCalled();
  });

  it('calls markFailed with correct nextAttemptAt on non-final attempt', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue('Internal Server Error'),
    });

    const before = Date.now();
    const job = makeJob({ attemptsMade: 1, opts: { attempts: 5 } });
    await expect(processDelivery(job)).rejects.toThrow('HTTP 500');
    const after = Date.now();

    expect(mockMarkFailed).toHaveBeenCalledTimes(1);

    const [, attemptCount, nextAttemptAt, responseStatus] = mockMarkFailed.mock.calls[0] as [
      string,
      number,
      Date,
      number,
    ];
    expect(attemptCount).toBe(2);
    expect(responseStatus).toBe(500);
    const expectedDelay = getBackoffDelay(2);
    expect(nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + expectedDelay);
    expect(nextAttemptAt.getTime()).toBeLessThanOrEqual(after + expectedDelay + 50);
  });

  it('calls markFailed with error message when fetch throws a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const job = makeJob({ attemptsMade: 0, opts: { attempts: 5 } });
    await expect(processDelivery(job)).rejects.toThrow('ECONNREFUSED');

    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    const [, , , , errorMsg] = mockMarkFailed.mock.calls[0] as [
      string,
      number,
      Date,
      null,
      string,
    ];
    expect(errorMsg).toBe('ECONNREFUSED');
  });

  it('calls markFailed when AbortController fires (timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );

    const job = makeJob({ attemptsMade: 0, opts: { attempts: 5 } });
    await expect(processDelivery(job)).rejects.toThrow();

    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
  });

  it('sends X-Hookstream-Signature header containing sha256=', async () => {
    let capturedHeaders: Record<string, string> | undefined;

    global.fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(''),
      });
    });

    const job = makeJob();
    await processDelivery(job);

    expect(capturedHeaders?.['X-Hookstream-Signature']).toMatch(/^sha256=/);
  });
});

describe('getBackoffDelay', () => {
  it('returns 0ms for slot 0', () => {
    expect(getBackoffDelay(0)).toBe(0);
  });

  it('returns 30s for slot 1', () => {
    expect(getBackoffDelay(1)).toBe(30_000);
  });

  it('returns 5m for slot 2', () => {
    expect(getBackoffDelay(2)).toBe(5 * 60_000);
  });

  it('returns 30m for slot 3', () => {
    expect(getBackoffDelay(3)).toBe(30 * 60_000);
  });

  it('returns 2h for slot 4', () => {
    expect(getBackoffDelay(4)).toBe(2 * 60 * 60_000);
  });

  it('returns 2h for slot beyond array bounds', () => {
    expect(getBackoffDelay(99)).toBe(2 * 60 * 60_000);
  });
});
