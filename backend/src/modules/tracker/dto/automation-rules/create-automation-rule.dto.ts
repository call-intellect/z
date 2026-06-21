import { z } from 'zod';

import {
  AutomationActionSchema,
  AutomationConditionSchema,
  AutomationTriggerSchema,
} from './automation-rule.types';

export const CreateAutomationRuleSchema = z
  .object({
    projectId: z.string().min(1).nullable().optional(),
    name: z.string().min(1).max(160),
    enabled: z.boolean().optional(),
    trigger: AutomationTriggerSchema,
    conditions: z.array(AutomationConditionSchema).max(20).optional(),
    actions: z.array(AutomationActionSchema).min(1).max(20),
  })
  .strict();

export type CreateAutomationRuleDto = z.infer<typeof CreateAutomationRuleSchema>;
