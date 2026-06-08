import { z } from 'zod';

import type {
  CustomerRiskLevel,
  CustomerRiskSignalCounts,
} from '../services/customer-risk.scoring';

/**
 * TZ-1 Фаза 1 (daily-value-engine) — DTO «Радар клиентов под риском».
 *
 * Снимок риска по клиенту с drill-down (signalCounts, topBlocks, дельта).
 * Используется COO-эндпоинтом `/dashboard/operations/customer-risk` и
 * self-эндпоинтом менеджера `/me/customer-risk`.
 */

/** Один блок-источник для drill-down. */
export interface CustomerRiskTopBlockDto {
  blockId: string;
  signalType: string;
  /** Краткая выдержка (name/criticalQuestion), усечённая. */
  excerpt: string;
}

export interface CustomerRiskSnapshotDto {
  id: string;
  customerEntityId: string;
  customerName: string;
  dateLocal: string;
  signalCounts: CustomerRiskSignalCounts;
  windowDays: number;
  riskScore: number;
  riskLevel: CustomerRiskLevel;
  /** Дельта riskScore к вчерашнему снимку (+приток / -отток). */
  scoreDelta: number;
  /** Дельта суммарного числа сигналов к вчерашнему снимку. */
  signalDelta: number;
  responsiblePersonId: string | null;
  responsiblePersonName: string | null;
  topBlocks: CustomerRiskTopBlockDto[];
  /** Человекочитаемая подсказка (LLM или детерминированный fallback). */
  hint: string;
  snapshotAt: string;
}

export interface CustomerRiskListDto {
  items: CustomerRiskSnapshotDto[];
  criticalCount: number;
  warningCount: number;
}

/** Query для `GET /dashboard/operations/customer-risk?level=&limit=`. */
export const CustomerRiskQuerySchema = z
  .object({
    level: z.enum(['critical', 'warning', 'ok']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict();

export type CustomerRiskQuery = z.infer<typeof CustomerRiskQuerySchema>;
