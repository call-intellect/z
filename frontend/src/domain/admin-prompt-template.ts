import type {
  MeetingTypeApi,
  OutputTypeApi,
  PromptTaskType,
  PromptTemplateApi,
  PromptTemplateScope,
  PromptTemplateStatus,
} from "@/api/admin-prompt-templates.api";

const SCOPE_LABEL: Record<PromptTemplateScope, string> = {
  system: "Системный",
  org: "Мой",
};

const STATUS_LABEL: Record<PromptTemplateStatus, string> = {
  draft: "Черновик",
  active: "Активен",
  archived: "Архив",
};

const STATUS_BADGE_COLOR: Record<
  PromptTemplateStatus,
  "green" | "gray" | "amber"
> = {
  active: "green",
  draft: "amber",
  archived: "gray",
};

const TASK_TYPE_LABEL: Record<PromptTaskType, string> = {
  summary: "Сводка",
  tasks: "Задачи",
  chapters: "Главы",
  "follow-up": "Письмо вдогон",
  "card-rollup": "Сводка карточки",
};

const MEETING_TYPE_LABEL: Record<MeetingTypeApi, string> = {
  team: "Командная встреча",
  standup: "Дейли-standup",
  plan_fact: "План-факт",
  project: "Проектная встреча",
  sales: "Продажи",
  custdev: "CustDev / интервью",
  partner: "Встреча с партнёром",
  interview: "Собеседование",
  customer_success: "Customer Success",
  review: "Обзорная встреча",
  retrospective: "Ретроспектива",
};

const OUTPUT_TYPE_LABEL: Record<OutputTypeApi, string> = {
  text: "Текст",
  bullet_list: "Список пунктов",
  table: "Таблица",
  json_object: "JSON-объект",
};

export type PromptTemplateUi = PromptTemplateApi & {
  scopeLabel: string;
  statusLabel: string;
  statusColor: "green" | "gray" | "amber";
  taskTypeLabel: string;
  meetingTypeLabel: string | null;
};

export function scopeLabel(s: PromptTemplateScope): string {
  return SCOPE_LABEL[s];
}

export function statusLabel(s: PromptTemplateStatus): string {
  return STATUS_LABEL[s];
}

export function taskTypeLabel(t: PromptTaskType): string {
  return TASK_TYPE_LABEL[t];
}

export function meetingTypeLabel(t: MeetingTypeApi | null): string | null {
  return t ? MEETING_TYPE_LABEL[t] : null;
}

export function outputTypeLabel(o: OutputTypeApi): string {
  return OUTPUT_TYPE_LABEL[o];
}

export function mapPromptTemplate(api: PromptTemplateApi): PromptTemplateUi {
  return {
    ...api,
    scopeLabel: SCOPE_LABEL[api.scope],
    statusLabel: STATUS_LABEL[api.status],
    statusColor: STATUS_BADGE_COLOR[api.status],
    taskTypeLabel: TASK_TYPE_LABEL[api.taskType],
    meetingTypeLabel: api.meetingType
      ? MEETING_TYPE_LABEL[api.meetingType]
      : null,
  };
}

export const DEMO_MEETING_LABEL: Record<string, string> = {
  "demo-sales": "Продажная встреча (10 мин, 2 спикера)",
  "demo-standup": "Короткий standup (5 мин, 4 спикера)",
  "demo-interview": "Собеседование (20 мин, 2 спикера)",
};
