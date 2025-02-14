// Exports a typed Config object — no process.env access anywhere else in the codebase
export interface Config {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisUrl: string;
  workerConcurrency: number;
  deliveryTimeoutMs: number;
  // Optional — enables the AI delivery diagnostics endpoint
  anthropicApiKey: string | undefined;
}

export function loadConfig(): Config {
  const required = ['DATABASE_URL', 'REDIS_URL'];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
  }
  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    databaseUrl: process.env['DATABASE_URL']!,
    redisUrl: process.env['REDIS_URL']!,
    workerConcurrency: parseInt(process.env['WORKER_CONCURRENCY'] ?? '5', 10),
    deliveryTimeoutMs: parseInt(process.env['DELIVERY_TIMEOUT_MS'] ?? '30000', 10),
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
  };
}
