import { z } from 'zod';

export const SprintHintKindValues = [
  'no_due_date',
  'no_description',
  'no_assignee',
  'due_date_at_risk',
  'recurring_carry_over',
  'no_recent_mentions',
  'conflicts_with_goal',
  'can_be_split',
  'similar_to_past_task',
  'generic',
] as const;
export type SprintHintKindDto = (typeof SprintHintKindValues)[number];

export const SprintHintSeverityValues = ['info', 'warning', 'critical'] as const;
export type SprintHintSeverityDto = (typeof SprintHintSeverityValues)[number];

export const SprintHintStatusValues = ['active', 'dismissed', 'resolved'] as const;
export type SprintHintStatusDto = (typeof SprintHintStatusValues)[number];

export interface SprintHintResponseDto {
  id: string;
  cycleId: string;
  kind: SprintHintKindDto;
  severity: SprintHintSeverityDto;
  title: string;
  body: string;
  affectedIssueIds: string[];
  sourceBlockIds: string[];
  status: SprintHintStatusDto;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListSprintHintsResponseDto {
  items: SprintHintResponseDto[];
  total: number;
}

export const ListSprintHintsQuerySchema = z
  .object({
    status: z.enum(SprintHintStatusValues).optional(),
  })
  .strict();
export type ListSprintHintsQueryDto = z.infer<typeof ListSprintHintsQuerySchema>;
