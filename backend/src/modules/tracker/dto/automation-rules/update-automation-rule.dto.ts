import { z } from 'zod';

import {
  AutomationActionSchema,
  AutomationConditionSchema,
  AutomationTriggerSchema,
} from './automation-rule.types';

export const UpdateAutomationRuleSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    enabled: z.boolean().optional(),
    trigger: AutomationTriggerSchema.optional(),
    conditions: z.array(AutomationConditionSchema).max(20).optional(),
    actions: z.array(AutomationActionSchema).min(1).max(20).optional(),
  })
  .strict();

export type UpdateAutomationRuleDto = z.infer<typeof UpdateAutomationRuleSchema>;
