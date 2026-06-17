import { z } from 'zod';

import type { PortfolioByStatus, PortfolioHealthLevel } from '../services/portfolio-health.scoring';

export type PortfolioPriorityKey = 'must' | 'should' | 'could' | 'wont' | 'none';

export const PORTFOLIO_PRIORITY_KEYS: readonly PortfolioPriorityKey[] = [
  'must',
  'should',
  'could',
  'wont',
  'none',
] as const;

export interface PortfolioPriorityBucketDto {
  count: number;
  achievedCount: number;
  achievedPercent: number;
}

export type PortfolioByPriorityDto = Record<PortfolioPriorityKey, PortfolioPriorityBucketDto>;

export interface PortfolioRowReasonDto {
  sourceBlockId: string;
}

export interface PortfolioHealthRowDto {
  goalId: string;
  name: string;
  progressStatus: string;
  priority: PortfolioPriorityKey | null;
  reason: PortfolioRowReasonDto | null;
}

export interface PortfolioHealthScaleDto {
  healthy: number;
  warning: number;
  level: PortfolioHealthLevel;
}

export interface PortfolioHealthDto {
  healthScore: number;
  scale: PortfolioHealthScaleDto;
  byStatus: PortfolioByStatus;
  byPriority: PortfolioByPriorityDto;
  rows: PortfolioHealthRowDto[];
  deltaVsPrevWeek: number | null;
}

export const PortfolioHealthQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

export type PortfolioHealthQuery = z.infer<typeof PortfolioHealthQuerySchema>;

export const SetGoalPrioritySchema = z
  .object({
    priority: z.enum(['must', 'should', 'could', 'wont']).nullable(),
  })
  .strict();

export type SetGoalPriorityDto = z.infer<typeof SetGoalPrioritySchema>;
