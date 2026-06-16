import { z } from 'zod';

export const MEETING_TYPES = [
  'team',
  'standup',
  'plan_fact',
  'project',
  'sales',
  'custdev',
  'partner',
  'interview',
  'customer_success',
  'review',
  'retrospective',
] as const;
export type MeetingTypeValue = (typeof MEETING_TYPES)[number];

export const TASK_TYPES = ['summary', 'tasks', 'chapters', 'follow-up', 'card-rollup'] as const;
export type TaskTypeValue = (typeof TASK_TYPES)[number];

export const SCOPES = ['system', 'org'] as const;
export type ScopeValue = (typeof SCOPES)[number];

export const STATUSES = ['draft', 'active', 'archived'] as const;
export type StatusValue = (typeof STATUSES)[number];

export const OUTPUT_TYPES = ['text', 'bullet_list', 'table', 'json_object'] as const;
export type OutputType = (typeof OUTPUT_TYPES)[number];

export const DEMO_MEETING_KEYS = ['demo-sales', 'demo-standup', 'demo-interview'] as const;
export type DemoMeetingKey = (typeof DEMO_MEETING_KEYS)[number];

export const ListPromptTemplatesQuerySchema = z.object({
  scope: z.enum(SCOPES).optional(),
  status: z.enum(STATUSES).optional(),
  meetingType: z.enum(MEETING_TYPES).optional(),
  taskType: z.enum(TASK_TYPES).optional(),
  search: z.string().min(1).max(120).optional(),
});
export type ListPromptTemplatesQueryDto = z.infer<typeof ListPromptTemplatesQuerySchema>;

export const SectionInputSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_-]+$/i, {
      message: 'Допустимы только латиница, цифры, дефис и подчёркивание',
    }),
  title: z.string().min(1).max(160),
  instruction: z.string().min(10).max(4000),
  outputType: z.enum(OUTPUT_TYPES),
  required: z.boolean().default(true),
  maxTokens: z.number().int().min(1).max(8000).nullable().optional(),
  order: z.number().int().min(1).max(30).optional(),
});
export type SectionInputDto = z.infer<typeof SectionInputSchema>;

export const CreatePromptTemplateSchema = z.object({
  scope: z.enum(SCOPES).default('system'),
  orgId: z.string().min(1).max(60).nullable().optional(),
  key: z
    .string()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9_-]+$/i, {
      message: 'Допустимы только латиница, цифры, дефис и подчёркивание',
    }),
  name: z.string().min(3).max(120),
  description: z.string().max(1000).nullable().optional(),
  meetingType: z.enum(MEETING_TYPES).nullable().optional(),
  taskType: z.enum(TASK_TYPES),
  systemPrompt: z.string().min(10).max(40000).optional(),
  toolName: z.string().min(1).max(120).nullable().optional(),
  sections: z.array(SectionInputSchema).min(0).max(30).optional(),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
});
export type CreatePromptTemplateDto = z.infer<typeof CreatePromptTemplateSchema>;

export const UpdatePromptTemplateSchema = z.object({
  name: z.string().min(3).max(120).optional(),
  description: z.string().max(1000).nullable().optional(),
  meetingType: z.enum(MEETING_TYPES).nullable().optional(),
  taskType: z.enum(TASK_TYPES).optional(),
});
export type UpdatePromptTemplateDto = z.infer<typeof UpdatePromptTemplateSchema>;

export const CreatePromptVersionSchema = z.object({
  systemPrompt: z.string().min(10).max(40000),
  toolName: z.string().min(1).max(120).nullable().optional(),
  sections: z.array(SectionInputSchema).min(0).max(30),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(2000).nullable().optional(),
  activate: z.boolean().default(false),
});
export type CreatePromptVersionDto = z.infer<typeof CreatePromptVersionSchema>;

export const CopyToOrgSchema = z.object({
  orgId: z.string().min(1).max(60),
  key: z.string().min(3).max(80).optional(),
  name: z.string().min(3).max(120).optional(),
});
export type CopyToOrgDto = z.infer<typeof CopyToOrgSchema>;

export const PreviewPromptSchema = z.object({
  demoMeetingKey: z.enum(DEMO_MEETING_KEYS),
  versionId: z.string().min(1).max(60).optional(),
});
export type PreviewPromptDto = z.infer<typeof PreviewPromptSchema>;
