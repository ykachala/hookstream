import { Router, Request, Response } from 'express';
import { authMiddleware } from '@/api/middleware/auth';
import { DeliveryRepository } from '@/db/repositories/DeliveryRepository';
import { Tenant } from '@/db/repositories/TenantRepository';

const deliveryRepo = new DeliveryRepository();

export const deadLetterRouter = Router();

deadLetterRouter.use(authMiddleware);

deadLetterRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const tenant = res.locals['tenant'] as Tenant;
  const limit = Math.min(parseInt((req.query['limit'] as string | undefined) ?? '20', 10), 100);
  const offset = parseInt((req.query['offset'] as string | undefined) ?? '0', 10);

  const { data, total } = await deliveryRepo.findDeadLetter(tenant.id, limit, offset);

  res.status(200).json({
    success: true,
    data,
    meta: { total, limit, offset },
  });
});
