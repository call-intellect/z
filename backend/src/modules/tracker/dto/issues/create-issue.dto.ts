import { z } from 'zod';

export const IssuePrioritySchema = z.enum(['urgent', 'high', 'medium', 'low', 'none']);

export const CreateIssueSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable().optional(),
    descriptionHtml: z.string().max(80_000).nullable().optional(),
    descriptionStripped: z.string().max(50_000).nullable().optional(),
    priority: IssuePrioritySchema.default('none'),
    stateId: z.string().max(64).nullable().optional(),
    parentId: z.string().max(64).nullable().optional(),
    estimatePoints: z.number().int().min(0).max(1000).nullable().optional(),
    sortOrder: z.number().int().default(0),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    cycleId: z.string().max(64).nullable().optional(),
    goalId: z.string().max(64).nullable().optional(),
    boardId: z.string().max(64).nullable().optional(),
    assigneeUserIds: z.array(z.string().min(1).max(64)).max(32).default([]),
    labelIds: z.array(z.string().min(1).max(64)).max(32).default([]),
    externalSource: z.string().max(40).nullable().optional(),
    externalId: z.string().max(200).nullable().optional(),
    sourceBlockIds: z.array(z.string().min(1).max(64)).max(64).optional(),
    inferSuggestions: z.boolean().optional(),
    respectHolidays: z.boolean().optional(),
  })
  .strict();

export type CreateIssueDto = z.infer<typeof CreateIssueSchema>;
