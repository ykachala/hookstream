import { getPool } from '@/db/client';

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead_letter';

export interface Delivery {
  id: string;
  eventId: string;
  subscriberId: string;
  tenantId: string;
  status: DeliveryStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliveryUpdate {
  status: DeliveryStatus;
  attemptCount: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  responseStatus: number | null;
  responseBody: string | null;
  error: string | null;
}

export interface DeliveryFilters {
  status?: DeliveryStatus;
  subscriberId?: string;
  limit: number;
  offset: number;
}

type DeliveryRow = {
  id: string;
  event_id: string;
  subscriber_id: string;
  tenant_id: string;
  status: DeliveryStatus;
  attempt_count: number;
  last_attempt_at: Date | null;
  next_attempt_at: Date | null;
  response_status: number | null;
  response_body: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

function rowToDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    eventId: row.event_id,
    subscriberId: row.subscriber_id,
    tenantId: row.tenant_id,
    status: row.status,
    attemptCount: row.attempt_count,
    lastAttemptAt: row.last_attempt_at,
    nextAttemptAt: row.next_attempt_at,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class DeliveryRepository {
  async create(eventId: string, subscriberId: string, tenantId: string): Promise<Delivery> {
    const { rows } = await getPool().query<DeliveryRow>(
      `INSERT INTO deliveries(event_id, subscriber_id, tenant_id)
       VALUES($1, $2, $3)
       RETURNING *`,
      [eventId, subscriberId, tenantId],
    );
    return rowToDelivery(rows[0]!);
  }

  async findById(id: string, tenantId: string): Promise<Delivery | null> {
    const { rows } = await getPool().query<DeliveryRow>(
      'SELECT * FROM deliveries WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    );
    if (!rows[0]) return null;
    return rowToDelivery(rows[0]);
  }

  async findByEventId(eventId: string, tenantId: string): Promise<Delivery[]> {
    const { rows } = await getPool().query<DeliveryRow>(
      `SELECT * FROM deliveries
       WHERE event_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC`,
      [eventId, tenantId],
    );
    return rows.map(rowToDelivery);
  }

  async findByTenantId(
    tenantId: string,
    filters: DeliveryFilters,
  ): Promise<{ data: Delivery[]; total: number }> {
    const conditions: string[] = ['tenant_id = $1'];
    const values: unknown[] = [tenantId];
    let idx = 2;

    if (filters.status !== undefined) {
      conditions.push(`status = $${idx++}`);
      values.push(filters.status);
    }
    if (filters.subscriberId !== undefined) {
      conditions.push(`subscriber_id = $${idx++}`);
      values.push(filters.subscriberId);
    }

    const where = conditions.join(' AND ');

    const [dataResult, countResult] = await Promise.all([
      getPool().query<DeliveryRow>(
        `SELECT * FROM deliveries WHERE ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
        [...values, filters.limit, filters.offset],
      ),
      getPool().query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count FROM deliveries WHERE ${where}`,
        values,
      ),
    ]);

    return {
      data: dataResult.rows.map(rowToDelivery),
      total: parseInt(countResult.rows[0]?.count ?? '0', 10),
    };
  }

  async findDeadLetter(
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: Delivery[]; total: number }> {
    return this.findByTenantId(tenantId, { status: 'dead_letter', limit, offset });
  }

  async update(id: string, patch: Partial<DeliveryUpdate>): Promise<Delivery | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    if (patch.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      values.push(patch.status);
    }
    if (patch.attemptCount !== undefined) {
      setClauses.push(`attempt_count = $${idx++}`);
      values.push(patch.attemptCount);
    }
    if (patch.lastAttemptAt !== undefined) {
      setClauses.push(`last_attempt_at = $${idx++}`);
      values.push(patch.lastAttemptAt);
    }
    if (patch.nextAttemptAt !== undefined) {
      setClauses.push(`next_attempt_at = $${idx++}`);
      values.push(patch.nextAttemptAt);
    }
    if (patch.responseStatus !== undefined) {
      setClauses.push(`response_status = $${idx++}`);
      values.push(patch.responseStatus);
    }
    if (patch.responseBody !== undefined) {
      setClauses.push(`response_body = $${idx++}`);
      values.push(patch.responseBody);
    }
    if (patch.error !== undefined) {
      setClauses.push(`error = $${idx++}`);
      values.push(patch.error);
    }

    values.push(id);
    const { rows } = await getPool().query<DeliveryRow>(
      `UPDATE deliveries SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    if (!rows[0]) return null;
    return rowToDelivery(rows[0]);
  }

  async markDelivered(id: string, responseStatus: number, responseBody: string): Promise<void> {
    await this.update(id, {
      status: 'delivered',
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
      responseStatus,
      responseBody,
      error: null,
    });
  }

  async markFailed(
    id: string,
    attemptCount: number,
    nextAttemptAt: Date,
    responseStatus: number | null,
    error: string,
  ): Promise<void> {
    await this.update(id, {
      status: 'failed',
      attemptCount,
      lastAttemptAt: new Date(),
      nextAttemptAt,
      responseStatus,
      error,
    });
  }

  async markDeadLetter(id: string, error: string): Promise<void> {
    await this.update(id, {
      status: 'dead_letter',
      lastAttemptAt: new Date(),
      nextAttemptAt: null,
      error,
    });
  }

  async findRecentFailures(
    tenantId: string,
    subscriberId: string,
    limit: number,
  ): Promise<Delivery[]> {
    const { rows } = await getPool().query<DeliveryRow>(
      `SELECT * FROM deliveries
       WHERE tenant_id = $1 AND subscriber_id = $2
         AND status IN ('failed', 'dead_letter')
       ORDER BY last_attempt_at DESC NULLS LAST
       LIMIT $3`,
      [tenantId, subscriberId, limit],
    );
    return rows.map(rowToDelivery);
  }
}
