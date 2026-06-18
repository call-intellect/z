import { z } from 'zod';

import type { ValueRecapPayload } from '../services/value-recap.scoring';

export const ValueRecapQuerySchema = z
  .object({
    period: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  })
  .strict();
export type ValueRecapQuery = z.infer<typeof ValueRecapQuerySchema>;

export const ValueRecapExportQuerySchema = z
  .object({
    format: z.enum(['slides', 'json', 'pptx']).optional().default('slides'),
  })
  .strict();
export type ValueRecapExportQuery = z.infer<typeof ValueRecapExportQuerySchema>;

export interface ValueRecapSnapshotDto {
  id: string;
  periodYm: string;
  payload: ValueRecapPayload | null;
  deliveredAt: string | null;
  openedAt: string | null;
  createdAt: string;
}

export interface ValueRecapSlideDto {
  title: string;
  subtitle?: string;
  bullets: string[];
}

export interface ValueRecapExportDto {
  format: 'slides' | 'json';
  periodYm: string;
  slides?: ValueRecapSlideDto[];
  payload?: ValueRecapPayload | null;
}
