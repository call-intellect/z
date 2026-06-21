import { z } from 'zod';

import {
  IssueTemplateConfigSchema,
  RecurrenceRuleSchema,
} from './issue-template-config.types';

export const UpdateIssueRecurrenceSchema = z
  .object({
    rule: RecurrenceRuleSchema.optional(),
    config: IssueTemplateConfigSchema.optional(),
    nextRunAt: z.coerce.date().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type UpdateIssueRecurrenceDto = z.infer<
  typeof UpdateIssueRecurrenceSchema
>;
