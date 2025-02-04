import crypto from 'crypto';
import { SubscriberRepository, Subscriber, SubscriberListItem } from '@/db/repositories/SubscriberRepository';

export class SubscriberService {
  constructor(private readonly repo: SubscriberRepository) {}

  async register(
    tenantId: string,
    url: string,
    eventTypes: string[],
  ): Promise<{ subscriber: Omit<Subscriber, 'secret'>; secret: string }> {
    const secret = crypto.randomBytes(32).toString('hex');
    const subscriber = await this.repo.create(tenantId, url, eventTypes, secret);
    const { secret: _, ...withoutSecret } = subscriber;
    return { subscriber: withoutSecret, secret };
  }

  async list(tenantId: string): Promise<SubscriberListItem[]> {
    return this.repo.findByTenantId(tenantId);
  }

  async getById(id: string, tenantId: string): Promise<Omit<Subscriber, 'secret'> | null> {
    const sub = await this.repo.findById(id, tenantId);
    if (!sub) return null;
    const { secret: _, ...withoutSecret } = sub;
    return withoutSecret;
  }

  async remove(id: string, tenantId: string): Promise<boolean> {
    return this.repo.delete(id, tenantId);
  }

  async setPaused(
    id: string,
    tenantId: string,
    paused: boolean,
  ): Promise<Omit<Subscriber, 'secret'> | null> {
    const sub = await this.repo.update(id, tenantId, { isActive: !paused });
    if (!sub) return null;
    const { secret: _, ...withoutSecret } = sub;
    return withoutSecret;
  }

  async rotateSecret(
    id: string,
    tenantId: string,
  ): Promise<{ newSecret: string } | null> {
    const newSecret = crypto.randomBytes(32).toString('hex');
    const sub = await this.repo.update(id, tenantId, { secret: newSecret });
    if (!sub) return null;
    return { newSecret };
  }
}
