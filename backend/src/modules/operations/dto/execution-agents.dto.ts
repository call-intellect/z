import { z } from 'zod';

export const ChronicBlockersQuerySchema = z
  .object({
    status: z.enum(['new', 'recurring', 'resolved']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .strict();

export type ChronicBlockersQuery = z.infer<typeof ChronicBlockersQuerySchema>;

export interface ChronicBlockerDto {
  id: string;
  representativeText: string;
  status: string;
  daysOpen: number;
  businessImpactScore: number;
  firstSeenDateLocal: string;
  lastSeenDateLocal: string;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
}

export interface ChronicBlockersListDto {
  items: ChronicBlockerDto[];
}

export const DecisionThroughputQuerySchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD')
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD')
      .optional(),
  })
  .strict();

export type DecisionThroughputQuery = z.infer<typeof DecisionThroughputQuerySchema>;

export interface DecisionThroughputDto {
  total: number;
  doneWithOutcomes: number;
  throughputPercent: number;
  from: string;
  to: string;
}

export interface StalledDecisionDto {
  id: string;
  statement: string;
  decidedAt: string | null;
  ageDays: number;
  implementationCheckedAt: string | null;
}

export interface StalledDecisionsListDto {
  items: StalledDecisionDto[];
}
