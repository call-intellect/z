import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CONSENT_DATA_TYPES } from '../services/consent.service';

export const ConsentUpsertSchema = z.object({
  dataType: z.enum(CONSENT_DATA_TYPES as unknown as [string, ...string[]]),
  consented: z.boolean(),
  policyVersion: z.string().min(1).max(10).optional(),
});

export class ConsentUpsertDto extends createZodDto(ConsentUpsertSchema) {}
export type ConsentUpsertBody = z.infer<typeof ConsentUpsertSchema>;
