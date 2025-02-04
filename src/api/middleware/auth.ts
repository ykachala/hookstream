import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { TenantRepository } from '@/db/repositories/TenantRepository';

const tenantRepo = new TenantRepository();

/**
 * Extracts Bearer token from Authorization header, hashes it with SHA-256,
 * and resolves the tenant. Attaches the tenant to res.locals.tenant.
 * Returns 401 if the header is missing, malformed, or the key is not found.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const tenant = await tenantRepo.findByApiKeyHash(hash);

  if (!tenant) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.locals['tenant'] = tenant;
  next();
}
