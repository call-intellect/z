import { z } from 'zod';

import { ISSUE_FIELD_TYPES } from '../../services/issue-field-validation.util';

export const IssueFieldTypeSchema = z.enum(ISSUE_FIELD_TYPES);

const IssueFieldOptionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  color: z.string().max(32).optional(),
});

export const IssueFieldConfigSchema = z
  .object({
    options: z.array(IssueFieldOptionSchema).optional(),
  })
  .strict();

export const CreateFieldDefSchema = z
  .object({
    projectId: z.string().min(1).nullable().optional(),
    name: z.string().min(1).max(100),
    type: IssueFieldTypeSchema,
    config: IssueFieldConfigSchema.optional(),
  })
  .strict();
export type CreateFieldDefDto = z.infer<typeof CreateFieldDefSchema>;
