import express, { Express } from 'express';
import pinoHttp from 'pino-http';
import { Config } from '@/config';
import { errorHandler } from '@/api/middleware/errorHandler';
import { healthRouter } from '@/api/routes/health';
import { subscribersRouter } from '@/api/routes/subscribers';
import { logger } from '@/logger';

export function createApp(config: Config): Express {
  void config; // config available for future route mounting
  const app = express();

  app.use(pinoHttp({ logger }));
  app.use(express.json());

  app.use(healthRouter);
  app.use('/api/v1/subscribers', subscribersRouter);

  app.use(errorHandler);

  return app;
}
