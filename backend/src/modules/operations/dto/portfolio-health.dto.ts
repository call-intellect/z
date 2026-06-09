import { z } from 'zod';

import type {
  PortfolioByStatus,
  PortfolioHealthLevel,
} from '../services/portfolio-health.scoring';

/**
 * ТЗ-2 Ф6.A (daily-value-dashboards) — DTO «Здоровье портфеля целей».
 *
 * Интегральный балл 0..100 + шкала/уровень, разрезы по статусу движения и по
 * MoSCoW-приоритету, построчный список целей с провенансом и дельта к прошлой
 * неделе. Используется COO-эндпоинтом
 * `GET /dashboard/operations/portfolio-health`.
 */

/** MoSCoW-приоритет цели (+ 'none' для нераспределённых). */
export type PortfolioPriorityKey = 'must' | 'should' | 'could' | 'wont' | 'none';

export const PORTFOLIO_PRIORITY_KEYS: readonly PortfolioPriorityKey[] = [
  'must',
  'should',
  'could',
  'wont',
  'none',
] as const;

/** Разрез одной корзины приоритета. */
export interface PortfolioPriorityBucketDto {
  count: number;
  achievedCount: number;
  /** achievedCount / count * 100 (0 если count = 0). */
  achievedPercent: number;
}

export type PortfolioByPriorityDto = Record<
  PortfolioPriorityKey,
  PortfolioPriorityBucketDto
>;

/** Провенанс цели (первый блок-источник). null для ручных целей. */
export interface PortfolioRowReasonDto {
  sourceBlockId: string;
}

/** Одна цель в построчном списке портфеля. */
export interface PortfolioHealthRowDto {
  goalId: string;
  name: string;
  progressStatus: string;
  priority: PortfolioPriorityKey | null;
  reason: PortfolioRowReasonDto | null;
}

/** Шкала здоровья (пороги + рассчитанный уровень). */
export interface PortfolioHealthScaleDto {
  healthy: number;
  warning: number;
  level: PortfolioHealthLevel;
}

export interface PortfolioHealthDto {
  /** Интегральный балл 0..100. */
  healthScore: number;
  scale: PortfolioHealthScaleDto;
  /** Разрез по статусу движения (count per progressStatus). */
  byStatus: PortfolioByStatus;
  byPriority: PortfolioByPriorityDto;
  rows: PortfolioHealthRowDto[];
  /** Дельта balla к прошлому снимку (раньше по dateLocal). null если нет. */
  deltaVsPrevWeek: number | null;
}

/** Query для `GET /dashboard/operations/portfolio-health?date=YYYY-MM-DD`. */
export const PortfolioHealthQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export type PortfolioHealthQuery = z.infer<typeof PortfolioHealthQuerySchema>;

/** Body для `PATCH /api/v1/goals/:id/priority`. */
export const SetGoalPrioritySchema = z
  .object({
    priority: z.enum(['must', 'should', 'could', 'wont']).nullable(),
  })
  .strict();

export type SetGoalPriorityDto = z.infer<typeof SetGoalPrioritySchema>;
