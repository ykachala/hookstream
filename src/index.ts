import { loadConfig } from '@/config';
import { createApp } from '@/api/server';
import { connectDb, disconnectDb } from '@/db/client';
import { initQueue, closeQueue } from '@/queue/queues';
import { logger } from '@/logger';

async function main(): Promise<void> {
  const config = loadConfig();

  await connectDb(config);
  logger.info('Database connected');

  initQueue(config);
  logger.info('Queue initialized');

  const app = createApp(config);
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Server listening');
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Graceful shutdown initiated');
    server.close(async () => {
      try {
        await closeQueue();
        await disconnectDb();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    });
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
