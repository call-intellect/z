export type PulsePatternsPeriod = "week" | "month";

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
  personId: string;
  personName: string;
  proScore: number;
  contraScore: number;
  netScore: number;
}

export interface PulsePatternGoalDepartmentApi {
  departmentId: string | null;
  departmentName: string;
  proScore: number;
  contraScore: number;
  netScore: number;
}

export interface PulsePatternGoalVectorItemApi {
  goalId: string;
  goalTitle: string;
  isPrimary: boolean;
  proScore: number;
  contraScore: number;
  netScore: number;
  topContributors: PulsePatternGoalContributorApi[];
  byDepartment: PulsePatternGoalDepartmentApi[];
}

export interface PulsePatternGoalVectorApi {
  goals: PulsePatternGoalVectorItemApi[];
  primaryGoalId: string | null;
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

export interface PulsePatternsApi {
  period: PulsePatternsPeriod;
  generatedAt: string;
  busFactor: PulsePatternBusFactorApi;
  recurringTopics: PulsePatternRecurringTopicApi;
  lowRoiMeetings: PulsePatternLowRoiMeetingApi;
  bottlenecks: PulsePatternBottleneckApi;
  goalVector: PulsePatternGoalVectorApi;
  knowledgeVelocity: PulsePatternKnowledgeVelocityApi;
}

export interface PulsePatternLowRoiMeetingDomain {
  meetingId: string;
  title: string;
  durationMinutes: number;
  participantCount: number;
  roiScore: number;
  startedAt: Date;
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
}

export function pulsePatternsFromApi(
  api: PulsePatternsApi,
): PulsePatternsDomain {
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
  };
}
