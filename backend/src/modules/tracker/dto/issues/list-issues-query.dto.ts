import { z } from 'zod';

import { IssuePrioritySchema } from './create-issue.dto';

export const ListIssuesQuerySchema = z
  .object({
    stateId: z.string().max(64).optional(),
    stateCategory: z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']).optional(),
    assigneeUserId: z.string().max(64).optional(),
    labelId: z.string().max(64).optional(),
    cycleId: z.string().max(64).optional(),
    goalId: z.string().max(64).optional(),
    boardId: z.string().max(64).optional(),
    priority: IssuePrioritySchema.optional(),
    parentId: z.string().max(64).optional(),
    includeArchived: z.coerce.boolean().default(false),
    includeDeleted: z.coerce.boolean().default(false),
    q: z.string().max(200).optional(),
    includeChildrenCount: z.coerce.boolean().default(false),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListIssuesQuery = z.infer<typeof ListIssuesQuerySchema>;

export const AddAssigneeSchema = z.object({ userId: z.string().min(1).max(64) }).strict();
export type AddAssigneeDto = z.infer<typeof AddAssigneeSchema>;

export const AddLabelSchema = z.object({ labelId: z.string().min(1).max(64) }).strict();
export type AddLabelDto = z.infer<typeof AddLabelSchema>;

export const LinkGoalSchema = z.object({ goalId: z.string().min(1).max(64) }).strict();
export type LinkGoalDto = z.infer<typeof LinkGoalSchema>;
