import { z } from 'zod';

export const ListAuditQuerySchema = z.object({
  adminUserId: z.string().trim().min(1).max(64).optional(),
  tenantId: z.string().trim().min(1).max(64).optional(),
  route: z.string().trim().min(1).max(255).optional(),
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAuditQueryDto = z.infer<typeof ListAuditQuerySchema>;

export const AuditStatsQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
});
export type AuditStatsQueryDto = z.infer<typeof AuditStatsQuerySchema>;
