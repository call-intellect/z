import { z } from 'zod';

/** ТЗ «Команда + доступы» Фаза 5 — канонический список капабилити (подмножество
 *  «что человек видит», без биллинговых осей). */
export const CAPABILITIES = [
  'memory:regulations',
  'memory:entities',
  'feature:graph',
  'panel:operations',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const UpsertCapabilitySchema = z.object({
  effect: z.enum(['allow', 'deny']),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type UpsertCapabilityDto = z.infer<typeof UpsertCapabilitySchema>;

export interface CapabilityOverrideItem {
  capability: Capability;
  effect: 'allow' | 'deny' | null;
  expiresAt: string | null;
}
