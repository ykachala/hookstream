import { Pool } from 'pg';
import { Config } from '@/config';

let pool: Pool;

export function getPool(): Pool {
  if (!pool) throw new Error('DB not connected');
  return pool;
}

export async function connectDb(config: Config): Promise<void> {
  pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  await pool.query('SELECT 1'); // verify connectivity
}

export async function disconnectDb(): Promise<void> {
  await pool?.end();
}

export async function checkDbHealth(): Promise<boolean> {
  try {
    await getPool().query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
