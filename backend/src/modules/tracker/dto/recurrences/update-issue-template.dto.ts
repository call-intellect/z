import { z } from 'zod';

import { IssueTemplateConfigSchema } from './issue-template-config.types';

export const UpdateIssueTemplateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    config: IssueTemplateConfigSchema.optional(),
  })
  .strict();

export type UpdateIssueTemplateDto = z.infer<typeof UpdateIssueTemplateSchema>;
