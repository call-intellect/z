import { z } from 'zod';

import type { ValueRecapPayload } from '../services/value-recap.scoring';

/**
 * TZ-1 Фаза 5 (daily-value-engine) — DTO месячной витрины value-recap.
 */

/** Query `GET /dashboard/operations/value-recap?period=YYYY-MM`. */
export const ValueRecapQuerySchema = z
  .object({
    /** Месяц витрины; default — прошлый месяц. */
    period: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  })
  .strict();
export type ValueRecapQuery = z.infer<typeof ValueRecapQuerySchema>;

/**
 * Query `GET /dashboard/operations/value-recap/:id/export?format=slides|json|pptx`.
 * `pptx` отдаёт binary-презентацию (Ф3 редизайн «Итоги месяца»).
 */
export const ValueRecapExportQuerySchema = z
  .object({
    format: z.enum(['slides', 'json', 'pptx']).optional().default('slides'),
  })
  .strict();
export type ValueRecapExportQuery = z.infer<typeof ValueRecapExportQuerySchema>;

/** Ответ `GET /dashboard/operations/value-recap`. */
export interface ValueRecapSnapshotDto {
  id: string;
  periodYm: string;
  payload: ValueRecapPayload | null;
  deliveredAt: string | null;
  openedAt: string | null;
  createdAt: string;
}

/** Один слайд минимального структурного экспорта. */
export interface ValueRecapSlideDto {
  /** Заголовок слайда. */
  title: string;
  /** Подзаголовок (опц.). */
  subtitle?: string;
  /** Строки-буллеты слайда. */
  bullets: string[];
}

/** Ответ `.../export?format=slides|json` (минимальный структурный экспорт). */
export interface ValueRecapExportDto {
  format: 'slides' | 'json';
  periodYm: string;
  /** Для format=slides — печатаемые слайды. */
  slides?: ValueRecapSlideDto[];
  /** Для format=json — сырой payload. */
  payload?: ValueRecapPayload | null;
}
