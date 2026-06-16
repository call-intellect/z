import { z } from 'zod';

export const PendingActionSourceSchema = z.enum(['curation', 'conflict', 'intake', 'probe']);
export type PendingActionSourceDto = z.infer<typeof PendingActionSourceSchema>;

export const PendingActionSeveritySchema = z.enum(['normal', 'urgent']);
export type PendingActionSeverityDto = z.infer<typeof PendingActionSeveritySchema>;

export const ListPendingActionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPendingActionsQuery = z.infer<typeof ListPendingActionsQuerySchema>;

export const SnoozePendingActionBodySchema = z.object({
  source: PendingActionSourceSchema,
  resourceType: z.string().trim().min(1).max(80),
  resourceId: z.string().trim().min(1).max(80),
  hours: z.coerce.number().int().min(1).max(720),
});
export type SnoozePendingActionBody = z.infer<typeof SnoozePendingActionBodySchema>;

export const ConfirmResolutionSchema = z.enum([
  'approve',
  'reject',
  'keep_old',
  'accept_new',
  'merge',
  'accept',
]);
export type ConfirmResolutionDto = z.infer<typeof ConfirmResolutionSchema>;

export const ConfirmPendingActionBodySchema = z.object({
  source: PendingActionSourceSchema,
  resourceId: z.string().trim().min(1).max(80),
  resolution: ConfirmResolutionSchema.optional(),
  answerText: z.string().trim().min(1).max(10_000).optional(),
  targetProjectId: z.string().trim().min(1).max(64).optional(),
});
export type ConfirmPendingActionBody = z.infer<typeof ConfirmPendingActionBodySchema>;
