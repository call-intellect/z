import { z } from 'zod';

export const WEBHOOK_EVENT_VALUES = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'comment.created',
  'comment.updated',
  'cycle.created',
  'cycle.completed',
  'project.created',
  'project.archived',
  'intake.created',
  'intake.triaged',
] as const;

export const WebhookEventSchema = z.enum(WEBHOOK_EVENT_VALUES);

export const CreateWebhookSchema = z
  .object({
    name: z.string().min(1).max(200),
    url: z.string().url().max(2_048),
    events: z.array(WebhookEventSchema).min(1).max(32),
    isActive: z.boolean().default(true),
    isInternal: z.boolean().default(false),
  })
  .strict();

export type CreateWebhookDto = z.infer<typeof CreateWebhookSchema>;
