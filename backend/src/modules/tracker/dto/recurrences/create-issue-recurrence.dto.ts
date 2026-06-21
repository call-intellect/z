import { z } from 'zod';

import {
  IssueTemplateConfigSchema,
  RecurrenceRuleSchema,
} from './issue-template-config.types';

export const CreateIssueRecurrenceSchema = z
  .object({
    projectId: z.string().min(1).max(64),
    templateIssueId: z.string().min(1).max(64).nullable().optional(),
    rule: RecurrenceRuleSchema,
    config: IssueTemplateConfigSchema,
    nextRunAt: z.coerce.date(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type CreateIssueRecurrenceDto = z.infer<
  typeof CreateIssueRecurrenceSchema
>;
