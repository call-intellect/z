import { z } from 'zod';

import { IssuePrioritySchema } from './create-issue.dto';

export const MyInboxQuerySchema = z
  .object({
    stateCategory: z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']).optional(),
    stateId: z.string().max(64).optional(),
    priority: IssuePrioritySchema.optional(),
    projectId: z.string().max(64).optional(),
    labelId: z.string().max(64).optional(),
    cycleId: z.string().max(64).optional(),
    dueBefore: z.coerce.date().optional(),
    dueAfter: z.coerce.date().optional(),
    includeArchived: z.coerce.boolean().default(false),
    includeDeleted: z.coerce.boolean().default(false),
    cursor: z.string().max(64).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MyInboxQuery = z.infer<typeof MyInboxQuerySchema>;
