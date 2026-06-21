import { z } from 'zod';

export const AUTOMATION_TRIGGER_TYPES = [
  'status_changed',
  'assigned',
  'created',
  'due_approaching',
  'label_added',
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export const AUTOMATION_CONDITION_OPS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gt',
  'lt',
  'is_empty',
  'is_not_empty',
] as const;

export type AutomationConditionOp = (typeof AUTOMATION_CONDITION_OPS)[number];

export const AUTOMATION_ACTION_TYPES = [
  'set_status',
  'assign',
  'add_label',
  'set_priority',
  'notify',
  'create_subtask',
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const AutomationTriggerSchema = z
  .object({
    type: z.enum(AUTOMATION_TRIGGER_TYPES),
    toCategory: z
      .enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled'])
      .optional(),
  })
  .strip();

export const AutomationConditionSchema = z
  .object({
    field: z.string().min(1).max(64),
    op: z.enum(AUTOMATION_CONDITION_OPS),
    value: z.unknown().optional(),
  })
  .strip();

export const AutomationActionSchema = z
  .object({
    type: z.enum(AUTOMATION_ACTION_TYPES),
    stateId: z.string().min(1).optional(),
    toCategory: z
      .enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled'])
      .optional(),
    assigneeUserId: z.string().min(1).optional(),
    assignTo: z.enum(['owner', 'creator']).optional(),
    labelId: z.string().min(1).optional(),
    priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
    message: z.string().max(2000).optional(),
    subtaskTitle: z.string().min(1).max(300).optional(),
  })
  .strip();

export type AutomationTrigger = z.infer<typeof AutomationTriggerSchema>;
export type AutomationCondition = z.infer<typeof AutomationConditionSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
