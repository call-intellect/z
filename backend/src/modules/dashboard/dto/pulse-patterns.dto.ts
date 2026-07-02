import { z } from 'zod';

export const PulsePatternsQuerySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
});
export type PulsePatternsQuery = z.infer<typeof PulsePatternsQuerySchema>;

export interface PulsePatternBusFactorItemDto {
  categoryName: string;
  expertsCount: number;
  topExperts: string[];
}

export interface PulsePatternBusFactorDto {
  critical: PulsePatternBusFactorItemDto[];
  warningCount: number;
  totalCategories: number;
}

export interface PulsePatternRecurringTopicItemDto {
  themeId: string | null;
  themeName: string;
  mentionCount: number;
  meetingCount: number;
  windowDays: number;
}

export interface PulsePatternRecurringTopicDto {
  topics: PulsePatternRecurringTopicItemDto[];
}

export interface PulsePatternLowRoiMeetingItemDto {
  meetingId: string;
  title: string;
  durationMinutes: number;
  participantCount: number;
  roiScore: number;
  startedAt: string;
}

export interface PulsePatternLowRoiMeetingDto {
  meetings: PulsePatternLowRoiMeetingItemDto[];
}

export interface PulsePatternBottleneckDepartmentDto {
  id: string;
  name: string;
}

export interface PulsePatternBottleneckTopPairDto {
  fromName: string;
  toName: string;
  severity: number;
}

export interface PulsePatternBottleneckDto {
  heatmap: number[][];
  departments: PulsePatternBottleneckDepartmentDto[];
  topPairs: PulsePatternBottleneckTopPairDto[];
}

export interface PulsePatternGoalContributorDto {
  personId: string;
  personName: string;
  proScore: number;
  contraScore: number;
  netScore: number;
}

export interface PulsePatternGoalDepartmentDto {
  departmentId: string | null;
  departmentName: string;
  proScore: number;
  contraScore: number;
  netScore: number;
}

export interface PulsePatternGoalVectorItemDto {
  goalId: string;
  goalTitle: string;
  isPrimary: boolean;
  proScore: number;
  contraScore: number;
  netScore: number;
  topContributors: PulsePatternGoalContributorDto[];
  byDepartment: PulsePatternGoalDepartmentDto[];
}

export interface PulsePatternGoalVectorDto {
  goals: PulsePatternGoalVectorItemDto[];
  primaryGoalId: string | null;
}

export interface PulsePatternKnowledgeVelocityResponderDto {
  personName: string;
  resolvedCount: number;
}

export interface PulsePatternKnowledgeVelocityDto {
  medianHours: number | null;
  resolvedGapsCount: number;
  openGapsCount: number;
  topResponders: PulsePatternKnowledgeVelocityResponderDto[];
}

export interface PulsePatternsDto {
  period: 'week' | 'month';
  generatedAt: string;
  busFactor: PulsePatternBusFactorDto;
  recurringTopics: PulsePatternRecurringTopicDto;
  lowRoiMeetings: PulsePatternLowRoiMeetingDto;
  bottlenecks: PulsePatternBottleneckDto;
  goalVector: PulsePatternGoalVectorDto;
  knowledgeVelocity: PulsePatternKnowledgeVelocityDto;
}
