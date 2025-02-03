/**
 * Integration test for the migration runner.
 *
 * Requires: TEST_DATABASE_URL env var pointing to a running PostgreSQL instance.
 * Run with: TEST_DATABASE_URL=... npm run test:integration
 */

import { Pool } from 'pg';
import * as dbClient from '@/db/client';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

describe('migrations', () => {
  let pool: Pool;

  beforeAll(async () => {
    if (!TEST_DB_URL) {
      throw new Error('TEST_DATABASE_URL env var is required for integration tests');
    }

    pool = new Pool({ connectionString: TEST_DB_URL, max: 5 });
    await pool.query('SELECT 1'); // verify connectivity

    // Redirect all getPool() calls in the runner to our test pool
    jest.spyOn(dbClient, 'getPool').mockReturnValue(pool);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await pool?.end();
  });

  it('runs all migrations and creates expected tables', async () => {
    const { runMigrations } = await import('@/db/migrations/runner');
    await runMigrations();

    const expectedTables = [
      'schema_migrations',
      'tenants',
      'subscribers',
      'events',
      'deliveries',
    ];

    for (const table of expectedTables) {
      const { rows } = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        ) AS exists`,
        [table],
      );
      expect(rows[0]?.exists).toBe(true);
    }
  });

  it('is idempotent — running migrations twice does not throw', async () => {
    const { runMigrations } = await import('@/db/migrations/runner');
    await expect(runMigrations()).resolves.not.toThrow();
  });
});
