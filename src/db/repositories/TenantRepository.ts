import { getPool } from '@/db/client';

export interface Tenant {
  id: string;
  name: string;
  apiKeyHash: string;
  createdAt: Date;
}

export class TenantRepository {
  async findByApiKeyHash(hash: string): Promise<Tenant | null> {
    const { rows } = await getPool().query<{
      id: string; name: string; api_key_hash: string; created_at: Date;
    }>(
      'SELECT id, name, api_key_hash, created_at FROM tenants WHERE api_key_hash = $1',
      [hash],
    );
    if (!rows[0]) return null;
    return { id: rows[0].id, name: rows[0].name, apiKeyHash: rows[0].api_key_hash, createdAt: rows[0].created_at };
  }

  async create(name: string, apiKeyHash: string): Promise<Tenant> {
    const { rows } = await getPool().query<{
      id: string; name: string; api_key_hash: string; created_at: Date;
    }>(
      'INSERT INTO tenants(name, api_key_hash) VALUES($1, $2) RETURNING id, name, api_key_hash, created_at',
      [name, apiKeyHash],
    );
    const row = rows[0]!;
    return { id: row.id, name: row.name, apiKeyHash: row.api_key_hash, createdAt: row.created_at };
  }
}
