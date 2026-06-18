import { z } from 'zod';

export interface DailyDigestMetricsDto {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topRedCheckIns: Array<{
    checkInId: string;
    personName: string | null;
    excerpt: string;
  }>;
  newBlockers: Array<{
    blockId: string;
    name: string;
    confidence: number;
  }>;
  overdueCommitments: Array<{
    blockId: string;
    name: string;
    dueDate: string | null;
    recipientPersonId: string | null;
  }>;
  goals: {
    completed: number;
    failed: number;
    activated: number;
    completedIds: string[];
    failedIds: string[];
  };
  newHighInsights: Array<{
    insightId: string;
    statement: string;
    kind: string;
    causeCategory: string | null;
  }>;
  decisions: Array<{
    decisionId: string;
    statement: string;
    status: string;
  }>;
}

export interface DailyDigestSourcesDto {
  checkInIds: string[];
  blockerIds: string[];
  commitmentIds: string[];
  goalIds: string[];
  insightIds: string[];
  decisionIds: string[];
}

export interface DailyDigestEventDto {
  kind: 'meeting' | 'decision' | 'signal';
  id: string;
  title: string;
  occurredAt: string;
  link: string;
  detail?: string;
}

export interface DailyDigestUrgentItemDto {
  kind: 'overdue_commitment' | 'raised_decision' | 'high_insight';
  id: string;
  title: string;
  link: string;
  badge: string;
  urgency: 'high' | 'medium';
}

export interface DailyDigestPersonShinedDto {
  personId: string;
  personName: string;
  reason: 'recognition_received' | 'helpful_acts' | 'commitments_kept';
  detail: string;
  link: string;
}

export interface DailyDigestPersonStruggledDto {
  personId: string;
  personName: string;
  reason: 'red_checkin' | 'broken_commitment' | 'silent_3_days';
  detail: string;
  link: string;
}

export interface DailyDigestCustomerAtRiskDto {
  customerName: string;
  riskLevel: 'critical' | 'warning';
  badge: string;
}

export interface DailyDigestChronicBlockerDto {
  id: string;
  representativeText: string;
  status: string;
  daysOpen: number;
  linkedInsightId: string | null;
  responsiblePersonId: string | null;
}

export interface DailyDigestTrendPointDto {
  dateLocal: string;
  totalCheckIns: number;
  greenShare: number;
  redShare: number;
  blockers: number;
  overdueCommitments: number;
  goalsCompleted: number;
  goalsFailed: number;
}

export interface DailyOperationsDigestDto {
  id: string;
  tenantId: string;
  dateLocal: string;
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: DailyDigestMetricsDto;
  sources: DailyDigestSourcesDto;
  llmTaskRouteId: string | null;
  deliveredAt: string | null;
  createdAt: string;
  eventsToday: DailyDigestEventDto[];
  urgentItems: DailyDigestUrgentItemDto[];
  whoShined: DailyDigestPersonShinedDto[];
  whoStruggled: DailyDigestPersonStruggledDto[];
  customersAtRisk: DailyDigestCustomerAtRiskDto[];
  chronicBlockers: DailyDigestChronicBlockerDto[];
  trend: DailyDigestTrendPointDto[];
}

export interface DailyDigestAggregates {
  dateLocal: string;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topRedCheckIns: Array<{ personName: string | null; excerpt: string }>;
  newBlockers: Array<{ name: string; confidence: number }>;
  overdueCommitments: Array<{ name: string; dueDate: string | null }>;
  goals: {
    completed: number;
    failed: number;
    activated: number;
  };
  newHighInsights: Array<{
    statement: string;
    kind: string;
    causeCategory: string | null;
  }>;
  decisions: Array<{ statement: string; status: string }>;
}

export const GetDailyDigestQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date должен быть YYYY-MM-DD'),
  })
  .strict();

export type GetDailyDigestQuery = z.infer<typeof GetDailyDigestQuerySchema>;
