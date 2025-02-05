import { deliveryQueue } from '@/queue/queues';

export interface DeliveryJobData {
  deliveryId: string;
  eventId: string;
  subscriberId: string;
  tenantId: string;
  url: string;
  secret: string;
  payload: Record<string, unknown>;
  eventType: string;
}

/**
 * Enqueues a delivery job with retry configuration.
 * Uses custom backoff (handled by the worker's backoff strategy).
 */
export async function enqueueDelivery(data: DeliveryJobData): Promise<void> {
  await deliveryQueue.add('deliver', data, {
    attempts: 5,
    backoff: { type: 'custom' },
    removeOnComplete: { count: 1000 },
    removeOnFail: false,
  });
}
