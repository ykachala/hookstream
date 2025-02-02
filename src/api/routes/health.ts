import { Router, Request, Response } from 'express';

const router = Router();

router.get('/health', (_req: Request, res: Response): void => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

export { router as healthRouter };
