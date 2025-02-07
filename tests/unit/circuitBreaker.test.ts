import { faker } from '@faker-js/faker';
import { CircuitBreaker } from '@/services/CircuitBreaker';

function makeRedisMock() {
  const store = new Map<string, string>();
  return {
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK' as const;
    }),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    }),
    incr: jest.fn(async (key: string) => {
      const v = parseInt(store.get(key) ?? '0', 10) + 1;
      store.set(key, v.toString());
      return v;
    }),
    _store: store,
  };
}

describe('CircuitBreaker', () => {
  it('state is CLOSED when failure count is below threshold', async () => {
    const redis = makeRedisMock();
    const cb = new CircuitBreaker(redis as never);
    const id = faker.string.uuid();

    for (let i = 0; i < 4; i++) {
      await cb.recordFailure(id);
    }

    const state = await cb.getState(id);
    expect(state).toBe('CLOSED');
  });

  it('state transitions to OPEN after 5th failure', async () => {
    const redis = makeRedisMock();
    const cb = new CircuitBreaker(redis as never);
    const id = faker.string.uuid();

    for (let i = 0; i < 5; i++) {
      await cb.recordFailure(id);
    }

    const state = await cb.getState(id);
    expect(state).toBe('OPEN');
  });

  it('state is HALF_OPEN after cooling period has elapsed', async () => {
    const redis = makeRedisMock();
    const cb = new CircuitBreaker(redis as never);
    const id = faker.string.uuid();

    for (let i = 0; i < 5; i++) {
      await cb.recordFailure(id);
    }

    const pastTimestamp = (Date.now() - 11 * 60 * 1000).toString();
    redis._store.set(`cb:${id}:opened_at`, pastTimestamp);

    const state = await cb.getState(id);
    expect(state).toBe('HALF_OPEN');
  });

  it('state returns to CLOSED after recordSuccess', async () => {
    const redis = makeRedisMock();
    const cb = new CircuitBreaker(redis as never);
    const id = faker.string.uuid();

    for (let i = 0; i < 5; i++) {
      await cb.recordFailure(id);
    }
    expect(await cb.getState(id)).toBe('OPEN');

    await cb.recordSuccess(id);
    expect(await cb.getState(id)).toBe('CLOSED');
  });

  it('state stays OPEN within cooling period', async () => {
    const redis = makeRedisMock();
    const cb = new CircuitBreaker(redis as never);
    const id = faker.string.uuid();

    for (let i = 0; i < 5; i++) {
      await cb.recordFailure(id);
    }

    const recentTimestamp = (Date.now() - 60 * 1000).toString();
    redis._store.set(`cb:${id}:opened_at`, recentTimestamp);

    const state = await cb.getState(id);
    expect(state).toBe('OPEN');
  });

  it('forceClose resets state to CLOSED', async () => {
    const redis = makeRedisMock();
    const cb = new CircuitBreaker(redis as never);
    const id = faker.string.uuid();

    for (let i = 0; i < 5; i++) {
      await cb.recordFailure(id);
    }
    expect(await cb.getState(id)).toBe('OPEN');

    await cb.forceClose(id);
    expect(await cb.getState(id)).toBe('CLOSED');
    expect(await cb.getFailureCount(id)).toBe(0);
  });
});
