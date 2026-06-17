import { z } from 'zod';

export const CreateIncidentRuleSchema = z.object({
  name: z.string().trim().min(1).max(255),
  trigger: z.enum(['queue_failed', 'cron_failed', 'manual']),
  condition: z.string().trim().min(1).max(1000),
  channel: z.enum(['log', 'web_push', 'email']).default('log'),
  enabled: z.boolean().default(true),
  confirmedNoMvp: z.boolean(),
});
export type CreateIncidentRuleDto = z.infer<typeof CreateIncidentRuleSchema>;
