import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { Config } from '@/config';

let redisClient: IORedis;
export let deliveryQueue: Queue;

export function initQueue(config: Config): void {
  redisClient = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  deliveryQueue = new Queue('delivery', { connection: redisClient });
}

export function getRedisClient(): IORedis {
  if (!redisClient) throw new Error('Redis not initialized');
  return redisClient;
}

export async function closeQueue(): Promise<void> {
  await deliveryQueue?.close();
  await redisClient?.quit();
}
