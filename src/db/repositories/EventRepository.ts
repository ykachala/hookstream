import { getPool } from '@/db/client';

export interface Event {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

type EventRow = {
  id: string;
  tenant_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

function rowToEvent(row: EventRow): Event {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

export class EventRepository {
  async create(tenantId: string, eventType: string, payload: Record<string, unknown>): Promise<Event> {
    const { rows } = await getPool().query<EventRow>(
      `INSERT INTO events(tenant_id, event_type, payload)
       VALUES($1, $2, $3)
       RETURNING id, tenant_id, event_type, payload, created_at`,
      [tenantId, eventType, JSON.stringify(payload)],
    );
    return rowToEvent(rows[0]!);
  }

  async findById(id: string, tenantId: string): Promise<Event | null> {
    const { rows } = await getPool().query<EventRow>(
      `SELECT id, tenant_id, event_type, payload, created_at
       FROM events
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (!rows[0]) return null;
    return rowToEvent(rows[0]);
  }

  async findByTenantId(
    tenantId: string,
    limit: number,
    offset: number,
  ): Promise<{ data: Event[]; total: number }> {
    const [dataResult, countResult] = await Promise.all([
      getPool().query<EventRow>(
        `SELECT id, tenant_id, event_type, payload, created_at
         FROM events
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset],
      ),
      getPool().query<{ count: string }>(
        'SELECT COUNT(*)::TEXT AS count FROM events WHERE tenant_id = $1',
        [tenantId],
      ),
    ]);

    return {
      data: dataResult.rows.map(rowToEvent),
      total: parseInt(countResult.rows[0]?.count ?? '0', 10),
    };
  }
}
