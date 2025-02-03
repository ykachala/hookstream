import { getPool } from '@/db/client';

export interface Subscriber {
  id: string;
  tenantId: string;
  url: string;
  eventTypes: string[];
  secret: string;
  isActive: boolean;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriberListItem {
  id: string;
  tenantId: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriberPatch {
  isActive?: boolean;
  isVerified?: boolean;
}

type SubscriberRow = {
  id: string;
  tenant_id: string;
  url: string;
  event_types: string[];
  secret: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: Date;
  updated_at: Date;
};

type SubscriberListRow = Omit<SubscriberRow, 'secret'>;

function rowToSubscriber(row: SubscriberRow): Subscriber {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    url: row.url,
    eventTypes: row.event_types,
    secret: row.secret,
    isActive: row.is_active,
    isVerified: row.is_verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToListItem(row: SubscriberListRow): SubscriberListItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    url: row.url,
    eventTypes: row.event_types,
    isActive: row.is_active,
    isVerified: row.is_verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SubscriberRepository {
  async create(tenantId: string, url: string, eventTypes: string[], secret: string): Promise<Subscriber> {
    const { rows } = await getPool().query<SubscriberRow>(
      `INSERT INTO subscribers(tenant_id, url, event_types, secret)
       VALUES($1, $2, $3, $4)
       RETURNING id, tenant_id, url, event_types, secret, is_active, is_verified, created_at, updated_at`,
      [tenantId, url, eventTypes, secret],
    );
    return rowToSubscriber(rows[0]!);
  }

  async findById(id: string, tenantId: string): Promise<Subscriber | null> {
    const { rows } = await getPool().query<SubscriberRow>(
      `SELECT id, tenant_id, url, event_types, secret, is_active, is_verified, created_at, updated_at
       FROM subscribers
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    if (!rows[0]) return null;
    return rowToSubscriber(rows[0]);
  }

  async findByTenantId(tenantId: string): Promise<SubscriberListItem[]> {
    const { rows } = await getPool().query<SubscriberListRow>(
      `SELECT id, tenant_id, url, event_types, is_active, is_verified, created_at, updated_at
       FROM subscribers
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId],
    );
    return rows.map(rowToListItem);
  }

  async findActiveByEventType(tenantId: string, eventType: string): Promise<SubscriberListItem[]> {
    const { rows } = await getPool().query<SubscriberListRow>(
      `SELECT id, tenant_id, url, event_types, is_active, is_verified, created_at, updated_at
       FROM subscribers
       WHERE tenant_id = $1
         AND is_active = true
         AND is_verified = true
         AND event_types @> ARRAY[$2::TEXT]`,
      [tenantId, eventType],
    );
    return rows.map(rowToListItem);
  }

  async update(id: string, tenantId: string, patch: SubscriberPatch): Promise<Subscriber | null> {
    const setClauses: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let idx = 1;

    if (patch.isActive !== undefined) {
      setClauses.push(`is_active = $${idx++}`);
      values.push(patch.isActive);
    }
    if (patch.isVerified !== undefined) {
      setClauses.push(`is_verified = $${idx++}`);
      values.push(patch.isVerified);
    }

    if (values.length === 0) {
      return this.findById(id, tenantId);
    }

    values.push(id, tenantId);
    const { rows } = await getPool().query<SubscriberRow>(
      `UPDATE subscribers
       SET ${setClauses.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING id, tenant_id, url, event_types, secret, is_active, is_verified, created_at, updated_at`,
      values,
    );
    if (!rows[0]) return null;
    return rowToSubscriber(rows[0]);
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const { rowCount } = await getPool().query(
      'DELETE FROM subscribers WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    );
    return (rowCount ?? 0) > 0;
  }
}
