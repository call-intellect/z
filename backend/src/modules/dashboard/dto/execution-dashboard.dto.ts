import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DashboardLayoutQuerySchema = z.object({
  role: z.enum(['owner', 'coo', 'member']),
  rhythm: z.enum(['today', 'week', 'month']),
});
export type DashboardLayoutQuery = z.infer<typeof DashboardLayoutQuerySchema>;

export const DashboardLayoutResponseSchema = z.object({
  role: z.string(),
  rhythm: z.string(),
  layout: z.array(z.string()).nullable(),
});
export type DashboardLayoutResponse = z.infer<typeof DashboardLayoutResponseSchema>;
export class DashboardLayoutResponseDto extends createZodDto(DashboardLayoutResponseSchema) {}

export const GoalVectorByPersonQuerySchema = z.object({
  goalId: z.string().optional(),
  period: z.enum(['day', 'week', 'month']).default('day'),
});
export type GoalVectorByPersonQuery = z.infer<typeof GoalVectorByPersonQuerySchema>;

export const GoalVectorPersonRowSchema = z.object({
  personId: z.string(),
  personName: z.string(),
  netScore: z.number(),
  proScore: z.number(),
  contraScore: z.number(),
  tasksDone: z.number(),
  tasksOpen: z.number(),
  direction: z.enum(['up', 'side', 'down']),
});
export type GoalVectorPersonRow = z.infer<typeof GoalVectorPersonRowSchema>;

export const GoalVectorByPersonResponseSchema = z.object({
  goalId: z.string().nullable(),
  goalTitle: z.string().nullable(),
  rows: z.array(GoalVectorPersonRowSchema),
});
export type GoalVectorByPersonResponse = z.infer<typeof GoalVectorByPersonResponseSchema>;
export class GoalVectorByPersonResponseDto extends createZodDto(
  GoalVectorByPersonResponseSchema,
) {}

export const IssueChainsQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type IssueChainsQuery = z.infer<typeof IssueChainsQuerySchema>;

export const IssueChainRowSchema = z.object({
  sourceIssueId: z.string(),
  sourceIdentifier: z.string(),
  sourceTitle: z.string(),
  targetIssueId: z.string(),
  targetIdentifier: z.string(),
  targetTitle: z.string(),
  relationType: z.enum(['blocks', 'blocked_by']),
});
export type IssueChainRow = z.infer<typeof IssueChainRowSchema>;

export const IssueChainsResponseSchema = z.object({
  chains: z.array(IssueChainRowSchema),
});
export type IssueChainsResponse = z.infer<typeof IssueChainsResponseSchema>;
export class IssueChainsResponseDto extends createZodDto(IssueChainsResponseSchema) {}

export const LoadByPersonRowSchema = z.object({
  userId: z.string(),
  personName: z.string(),
  activeTasks: z.number(),
  level: z.enum(['overload', 'normal', 'idle']),
});
export type LoadByPersonRow = z.infer<typeof LoadByPersonRowSchema>;

export const LoadByPersonResponseSchema = z.object({
  rows: z.array(LoadByPersonRowSchema),
});
export type LoadByPersonResponse = z.infer<typeof LoadByPersonResponseSchema>;
export class LoadByPersonResponseDto extends createZodDto(LoadByPersonResponseSchema) {}

export const DigestTrendQuerySchema = z.object({
  period: z.enum(['day', 'week']).default('day'),
});
export type DigestTrendQuery = z.infer<typeof DigestTrendQuerySchema>;

export const DigestTrendResponseSchema = z.object({
  period: z.string(),
  current: z.record(z.string(), z.any()).nullable(),
  previous: z.record(z.string(), z.any()).nullable(),
  deltas: z.record(z.string(), z.number()),
});
export type DigestTrendResponse = z.infer<typeof DigestTrendResponseSchema>;
export class DigestTrendResponseDto extends createZodDto(DigestTrendResponseSchema) {}
