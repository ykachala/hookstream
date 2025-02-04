import { Tenant } from '@/db/repositories/TenantRepository';

declare global {
  namespace Express {
    interface Locals {
      tenant: Tenant;
    }
  }
}
