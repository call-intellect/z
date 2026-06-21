import { z } from 'zod';

import { IssueTemplateConfigSchema } from './issue-template-config.types';

export const CreateIssueTemplateSchema = z
  .object({
    projectId: z.string().min(1).max(64).nullable().optional(),
    name: z.string().min(1).max(160),
    config: IssueTemplateConfigSchema,
  })
  .strict();

export type CreateIssueTemplateDto = z.infer<typeof CreateIssueTemplateSchema>;
