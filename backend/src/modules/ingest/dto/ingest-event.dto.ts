import type { DataClass } from '@prisma/client';
import { z } from 'zod';

export const IngestEventSchema = z.object({
  tenantId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceExternalId: z.string().min(1).optional(),
  occurredAt: z.string().datetime({ offset: true }),
  payload: z.unknown(),
  dataClass: z
    .enum(['public', 'internal', 'sensitive', 'private'] as [DataClass, ...DataClass[]])
    .optional(),
});

export type IngestEventDto = z.infer<typeof IngestEventSchema>;
