import http from 'http';
import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { loadConfig } from '@/config';
import { createApp } from '@/api/server';
import { connectDb, disconnectDb } from '@/db/client';
import { initQueue, closeQueue, deliveryQueue } from '@/queue/queues';
import { createDeliveryWorker } from '@/workers/deliveryWorker';
import { logger } from '@/logger';

async function main(): Promise<void> {
  const config = loadConfig();

  await connectDb(config);
  logger.info('Database connected');

  initQueue(config);
  logger.info('Queue initialized');

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/');
  createBullBoard({
    queues: [new BullMQAdapter(deliveryQueue)],
    serverAdapter,
  });

  const boardApp = express();
  boardApp.use('/', serverAdapter.getRouter());
  const boardServer = http.createServer(boardApp);
  boardServer.listen(3001, () => {
    logger.info('BullMQ Board listening on port 3001');
  });

  const worker = createDeliveryWorker(config.workerConcurrency);
  logger.info({ concurrency: config.workerConcurrency }, 'Delivery worker started');

  const app = createApp(config);
  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'Server listening');
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Graceful shutdown initiated');
    boardServer.close();
    server.close(async () => {
      try {
        await worker.close();
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
