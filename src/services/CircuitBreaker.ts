import { Redis } from 'ioredis';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const FAILURE_THRESHOLD = 5;
const COOLING_PERIOD_MS = 10 * 60 * 1000;

export class CircuitBreaker {
  constructor(private readonly redis: Redis) {}

  private key(subscriberId: string): string {
    return `cb:${subscriberId}`;
  }

  private openedAtKey(subscriberId: string): string {
    return `cb:${subscriberId}:opened_at`;
  }

  async getState(subscriberId: string): Promise<CircuitState> {
    const failures = await this.redis.get(this.key(subscriberId));
    const count = parseInt(failures ?? '0', 10);
    if (count < FAILURE_THRESHOLD) return 'CLOSED';

    const openedAt = await this.redis.get(this.openedAtKey(subscriberId));
    if (!openedAt) return 'OPEN';

    const elapsed = Date.now() - parseInt(openedAt, 10);
    return elapsed >= COOLING_PERIOD_MS ? 'HALF_OPEN' : 'OPEN';
  }

  async recordSuccess(subscriberId: string): Promise<void> {
    await this.redis.del(this.key(subscriberId), this.openedAtKey(subscriberId));
  }

  async recordFailure(subscriberId: string): Promise<void> {
    const newCount = await this.redis.incr(this.key(subscriberId));
    if (newCount === FAILURE_THRESHOLD) {
      await this.redis.set(this.openedAtKey(subscriberId), Date.now().toString());
    }
  }

  async forceClose(subscriberId: string): Promise<void> {
    await this.redis.del(this.key(subscriberId), this.openedAtKey(subscriberId));
  }

  async getFailureCount(subscriberId: string): Promise<number> {
    const v = await this.redis.get(this.key(subscriberId));
    return parseInt(v ?? '0', 10);
  }
}
