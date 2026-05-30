import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { CONSENT_DATA_TYPES } from '../services/consent.service';

/**
 * Pulse Wave 4 §4.1 — тело POST `/api/v1/me/consents`.
 */
export const ConsentUpsertSchema = z.object({
  dataType: z.enum(CONSENT_DATA_TYPES as unknown as [string, ...string[]]),
  consented: z.boolean(),
  /// Опциональная версия текста согласия (UI может передавать `v1`, `v2`…).
  policyVersion: z.string().min(1).max(10).optional(),
});

export class ConsentUpsertDto extends createZodDto(ConsentUpsertSchema) {}
export type ConsentUpsertBody = z.infer<typeof ConsentUpsertSchema>;
