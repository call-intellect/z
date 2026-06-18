import { z } from 'zod';

import type {
  CustomerRiskLevel,
  CustomerRiskSignalCounts,
} from '../services/customer-risk.scoring';

export interface CustomerRiskTopBlockDto {
  blockId: string;
  signalType: string;
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
  scoreDelta: number;
  signalDelta: number;
  responsiblePersonId: string | null;
  responsiblePersonName: string | null;
  topBlocks: CustomerRiskTopBlockDto[];
  hint: string;
  snapshotAt: string;
}

export interface CustomerRiskListDto {
  items: CustomerRiskSnapshotDto[];
  criticalCount: number;
  warningCount: number;
}

export const CustomerRiskQuerySchema = z
  .object({
    level: z.enum(['critical', 'warning', 'ok']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict();

export type CustomerRiskQuery = z.infer<typeof CustomerRiskQuerySchema>;
