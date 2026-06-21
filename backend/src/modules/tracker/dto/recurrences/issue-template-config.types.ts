import { z } from 'zod';

import { IssuePrioritySchema } from '../issues/create-issue.dto';

export const IssueTemplateChecklistItemSchema = z
  .object({
    text: z.string().min(1).max(500),
  })
  .strict();

export const IssueTemplateChecklistSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    items: z.array(IssueTemplateChecklistItemSchema).max(100),
  })
  .strict();

export const IssueTemplateConfigSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable().optional(),
    priority: IssuePrioritySchema.optional(),
    estimatePoints: z.number().int().min(0).max(1000).nullable().optional(),
    checklist: z.array(IssueTemplateChecklistSchema).max(20).optional(),
    labelIds: z.array(z.string().min(1).max(64)).max(32).optional(),
    assigneeUserIds: z.array(z.string().min(1).max(64)).max(32).optional(),
    assigneeRole: z.string().max(64).optional(),
  })
  .strict();

export type IssueTemplateConfig = z.infer<typeof IssueTemplateConfigSchema>;

export const RecurrenceFrequencySchema = z.enum(['daily', 'weekly', 'monthly']);

export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequencySchema>;

export const RecurrenceRuleSchema = z
  .object({
    freq: RecurrenceFrequencySchema,
    interval: z.number().int().min(1).max(365).default(1),
    byweekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  })
  .strict();

export type RecurrenceRule = z.infer<typeof RecurrenceRuleSchema>;
