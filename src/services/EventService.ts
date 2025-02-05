import { EventRepository, Event } from '@/db/repositories/EventRepository';
import { SubscriberRepository } from '@/db/repositories/SubscriberRepository';
import { DeliveryRepository } from '@/db/repositories/DeliveryRepository';
import { enqueueDelivery } from '@/queue/producers';

export class EventService {
  constructor(
    private readonly eventRepo: EventRepository,
    private readonly subscriberRepo: SubscriberRepository,
    private readonly deliveryRepo: DeliveryRepository,
  ) {}

  /**
   * Creates an event record, finds all active+verified subscribers matching the
   * event type, creates a delivery record per subscriber, and enqueues each
   * delivery for dispatch.
   */
  async ingest(
    tenantId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<{ eventId: string; enqueuedCount: number }> {
    const event = await this.eventRepo.create(tenantId, eventType, payload);
    const subscribers = await this.subscriberRepo.findActiveByEventType(tenantId, eventType);
    let enqueuedCount = 0;

    for (const subscriber of subscribers) {
      const delivery = await this.deliveryRepo.create(event.id, subscriber.id, tenantId);
      // Fetch the subscriber with secret for HMAC signing
      const subWithSecret = await this.subscriberRepo.findById(subscriber.id, tenantId);
      if (!subWithSecret) continue;
      await enqueueDelivery({
        deliveryId: delivery.id,
        eventId: event.id,
        subscriberId: subscriber.id,
        tenantId,
        url: subscriber.url,
        secret: subWithSecret.secret,
        payload,
        eventType,
      });
      enqueuedCount++;
    }

    return { eventId: event.id, enqueuedCount };
  }

  /**
   * Returns a single event by id, scoped to the tenant.
   */
  async getEvent(id: string, tenantId: string): Promise<Event | null> {
    return this.eventRepo.findById(id, tenantId);
  }
}
