import { Worker, Job } from 'bullmq';
import { getRedisClient } from '@/queue/queues';
import { DeliveryJobData } from '@/queue/producers';
import { DeliveryRepository } from '@/db/repositories/DeliveryRepository';
import { signPayload } from '@/workers/hmac';
import { logger } from '@/logger';
import { getBackoffDelay } from '@/workers/backoff';

const deliveryRepo = new DeliveryRepository();

export async function processDelivery(job: Job<DeliveryJobData>): Promise<void> {
  const { deliveryId, url, secret, payload, eventType, tenantId } = job.data;
  const body = JSON.stringify({ event_type: eventType, payload });
  const signature = signPayload(body, secret);

  let responseStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hookstream-Signature': signature,
          'X-Hookstream-Event': eventType,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      responseStatus = response.status;
      responseBody = await response.text().catch(() => null);

      if (response.ok) {
        await deliveryRepo.markDelivered(deliveryId, responseStatus, responseBody ?? '');
        return;
      }
      errorMessage = `HTTP ${responseStatus}`;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  const attemptCount = job.attemptsMade + 1;
  const isLastAttempt = attemptCount >= (job.opts.attempts ?? 5);

  if (isLastAttempt) {
    await deliveryRepo.markDeadLetter(deliveryId, errorMessage ?? 'Unknown error');
    logger.warn({ deliveryId, tenantId, url, attemptCount }, 'Delivery dead-lettered');
  } else {
    const nextDelay = getBackoffDelay(attemptCount);
    const nextAttemptAt = new Date(Date.now() + nextDelay);
    await deliveryRepo.markFailed(
      deliveryId,
      attemptCount,
      nextAttemptAt,
      responseStatus,
      errorMessage ?? 'Unknown error',
    );
  }

  throw new Error(errorMessage ?? 'Delivery failed');
}

export function createDeliveryWorker(concurrency: number): Worker<DeliveryJobData> {
  return new Worker<DeliveryJobData>('deliveries', processDelivery, {
    connection: getRedisClient(),
    concurrency,
    settings: {
      backoffStrategy: (attemptsMade: number) => getBackoffDelay(attemptsMade),
    },
  });
}
