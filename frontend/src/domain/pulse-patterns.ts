/**
 * Pulse Wave 6 — единый агрегатор паттернов для главной директора.
 *
 * Источник правды:
 *   `backend/src/modules/dashboard/dto/pulse-patterns.dto.ts`
 *
 * Контракт: `GET /api/v1/dashboard/pulse-patterns?period=week|month`.
 *
 * Слоистая модель: ApiDto → DomainModel (см. skill `frontend-rules`). Все
 * Date-поля парсятся в Date один раз на границе.
 */

// ─── API DTO (зеркало backend) ──────────────────────────────────────────────

export type PulsePatternsPeriod = 'week' | 'month';

export interface PulsePatternBusFactorItemApi {
  categoryName: string;
  expertsCount: number;
  topExperts: string[];
}

export interface PulsePatternBusFactorApi {
  critical: PulsePatternBusFactorItemApi[];
  warningCount: number;
  totalCategories: number;
}

export interface PulsePatternRecurringTopicItemApi {
  themeId: string | null;
  themeName: string;
  mentionCount: number;
  meetingCount: number;
  windowDays: number;
}

export interface PulsePatternRecurringTopicApi {
  topics: PulsePatternRecurringTopicItemApi[];
}

export interface PulsePatternLowRoiMeetingItemApi {
  meetingId: string;
  title: string;
  durationMinutes: number;
  participantCount: number;
  roiScore: number;
  startedAt: string;
}

export interface PulsePatternLowRoiMeetingApi {
  meetings: PulsePatternLowRoiMeetingItemApi[];
}

export interface PulsePatternBottleneckDepartmentApi {
  id: string;
  name: string;
}

export interface PulsePatternBottleneckTopPairApi {
  fromName: string;
  toName: string;
  severity: number;
}

export interface PulsePatternBottleneckApi {
  heatmap: number[][];
  departments: PulsePatternBottleneckDepartmentApi[];
  topPairs: PulsePatternBottleneckTopPairApi[];
}

export interface PulsePatternGoalContributorApi {
  personName: string;
  netScore: number;
}

export interface PulsePatternGoalVectorItemApi {
  goalId: string;
  goalTitle: string;
  netScore: number;
  topContributors: PulsePatternGoalContributorApi[];
}

export interface PulsePatternGoalVectorApi {
  goals: PulsePatternGoalVectorItemApi[];
}

export interface PulsePatternKnowledgeVelocityResponderApi {
  personName: string;
  resolvedCount: number;
}

export interface PulsePatternKnowledgeVelocityApi {
  medianHours: number | null;
  resolvedGapsCount: number;
  openGapsCount: number;
  topResponders: PulsePatternKnowledgeVelocityResponderApi[];
}

export interface PulsePatternIrreversibleDecisionItemApi {
  decisionId: string;
  statement: string;
  decidedAt: string;
  hasAlternatives: boolean;
}

export interface PulsePatternIrreversibleDecisionsApi {
  decisions: PulsePatternIrreversibleDecisionItemApi[];
  alertCount: number;
}

export interface PulsePatternsApi {
  period: PulsePatternsPeriod;
  generatedAt: string;
  busFactor: PulsePatternBusFactorApi;
  recurringTopics: PulsePatternRecurringTopicApi;
  lowRoiMeetings: PulsePatternLowRoiMeetingApi;
  bottlenecks: PulsePatternBottleneckApi;
  goalVector: PulsePatternGoalVectorApi;
  knowledgeVelocity: PulsePatternKnowledgeVelocityApi;
  irreversibleDecisions: PulsePatternIrreversibleDecisionsApi;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface PulsePatternLowRoiMeetingDomain {
  meetingId: string;
  title: string;
  durationMinutes: number;
  participantCount: number;
  roiScore: number;
  startedAt: Date;
}

export interface PulsePatternIrreversibleDecisionDomain {
  decisionId: string;
  statement: string;
  decidedAt: Date;
  hasAlternatives: boolean;
}

export interface PulsePatternsDomain {
  period: PulsePatternsPeriod;
  generatedAt: Date;
  busFactor: PulsePatternBusFactorApi;
  recurringTopics: PulsePatternRecurringTopicApi;
  lowRoiMeetings: {
    meetings: PulsePatternLowRoiMeetingDomain[];
  };
  bottlenecks: PulsePatternBottleneckApi;
  goalVector: PulsePatternGoalVectorApi;
  knowledgeVelocity: PulsePatternKnowledgeVelocityApi;
  irreversibleDecisions: {
    decisions: PulsePatternIrreversibleDecisionDomain[];
    alertCount: number;
  };
}

// ─── Mapper ─────────────────────────────────────────────────────────────────

export function pulsePatternsFromApi(api: PulsePatternsApi): PulsePatternsDomain {
  return {
    period: api.period,
    generatedAt: new Date(api.generatedAt),
    busFactor: api.busFactor,
    recurringTopics: api.recurringTopics,
    lowRoiMeetings: {
      meetings: api.lowRoiMeetings.meetings.map((m) => ({
        meetingId: m.meetingId,
        title: m.title,
        durationMinutes: m.durationMinutes,
        participantCount: m.participantCount,
        roiScore: m.roiScore,
        startedAt: new Date(m.startedAt),
      })),
    },
    bottlenecks: api.bottlenecks,
    goalVector: api.goalVector,
    knowledgeVelocity: api.knowledgeVelocity,
    irreversibleDecisions: {
      alertCount: api.irreversibleDecisions.alertCount,
      decisions: api.irreversibleDecisions.decisions.map((d) => ({
        decisionId: d.decisionId,
        statement: d.statement,
        decidedAt: new Date(d.decidedAt),
        hasAlternatives: d.hasAlternatives,
      })),
    },
  };
}
