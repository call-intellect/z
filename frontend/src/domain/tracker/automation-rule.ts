export const AUTOMATION_TRIGGER_TYPES = [
  "status_changed",
  "assigned",
  "created",
  "due_approaching",
  "label_added",
] as const;

export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export const AUTOMATION_ACTION_TYPES = [
  "set_status",
  "assign",
  "add_label",
  "set_priority",
  "notify",
  "create_subtask",
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const AUTOMATION_CONDITION_OPS = [
  "eq",
  "neq",
  "in",
  "not_in",
  "gt",
  "lt",
  "is_empty",
  "is_not_empty",
] as const;

export type AutomationConditionOp = (typeof AUTOMATION_CONDITION_OPS)[number];

export interface AutomationTrigger {
  type: AutomationTriggerType;
  toCategory?: string;
}

export interface AutomationCondition {
  field: string;
  op: AutomationConditionOp;
  value?: unknown;
}

export interface AutomationAction {
  type: AutomationActionType;
  stateId?: string;
  toCategory?: string;
  assigneeUserId?: string;
  assignTo?: "owner" | "creator";
  labelId?: string;
  priority?: "urgent" | "high" | "medium" | "low" | "none";
  message?: string;
  subtaskTitle?: string;
}

export interface AutomationRuleApi {
  id: string;
  projectId: string | null;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRule {
  id: string;
  projectId: string | null;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  status_changed: "Сменился статус",
  assigned: "Назначен исполнитель",
  created: "Задача создана",
  due_approaching: "Приближается срок",
  label_added: "Добавлена метка",
};

export const AUTOMATION_ACTION_LABELS: Record<AutomationActionType, string> = {
  set_status: "Сменить статус",
  assign: "Назначить исполнителя",
  add_label: "Добавить метку",
  set_priority: "Задать приоритет",
  notify: "Уведомить",
  create_subtask: "Создать подзадачу",
};

export function automationRuleFromApi(api: AutomationRuleApi): AutomationRule {
  return {
    id: api.id,
    projectId: api.projectId,
    name: api.name,
    enabled: api.enabled,
    trigger: api.trigger,
    conditions: api.conditions ?? [],
    actions: api.actions ?? [],
    createdById: api.createdById,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}
