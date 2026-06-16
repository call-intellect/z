import type {
  CompletenessParentCardTypeApi,
  CompletenessSlotApi,
  CompletenessSlotKindApi,
  CompletenessSlotStatusApi,
} from "@/api/curation.api";

export type CompletenessParentCardType = CompletenessParentCardTypeApi;
export type CompletenessSlotKind = CompletenessSlotKindApi;
export type CompletenessSlotStatus = CompletenessSlotStatusApi;

export interface CompletenessSlot {
  id: string;
  tenantId: string;
  parentCardType: CompletenessParentCardType;
  parentCardId: string;
  slotName: string;
  slotKind: CompletenessSlotKind;
  status: CompletenessSlotStatus;
  filledAt: Date | null;
  filledByUserId: string | null;
  lastProbedAt: Date | null;
  probeAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const CARD_TYPE_LABEL: Record<CompletenessParentCardType, string> = {
  regulation: "Регламент",
  process: "Процесс",
  role: "Должность",
  company_profile: "Профиль компании",
};

const SLOT_KIND_LABEL: Record<CompletenessSlotKind, string> = {
  required: "обязательный",
  optional: "желательный",
};

const SLOT_STATUS_LABEL: Record<CompletenessSlotStatus, string> = {
  open: "не заполнен",
  filled: "заполнен",
};

const SLOT_NAME_LABEL: Record<string, string> = {
  statement: "Формулировка",
  owner_person: "Ответственный",
  scope: "Область действия",
  current_version: "Текущая версия",
  last_confirmed_at: "Последнее подтверждение",
  owner_role: "Владелец процесса",
  trigger: "Триггер запуска",
  has_steps: "Шаги процесса",
  inputs: "Входы",
  outputs: "Выходы",
  metrics: "Метрики",
  sla: "SLA",
  department: "Отдел",
  mission_statement: "Миссия должности",
  has_responsibility: "Зоны ответственности",
  tags: "Теги",
  display_name: "Название компании",
  mission: "Миссия",
  vision: "Видение",
  strategy: "Стратегия",
  stage: "Стадия",
};

export function completenessCardTypeLabel(
  t: CompletenessParentCardType,
): string {
  return CARD_TYPE_LABEL[t] ?? t;
}

export function completenessSlotKindLabel(k: CompletenessSlotKind): string {
  return SLOT_KIND_LABEL[k] ?? k;
}

export function completenessSlotStatusLabel(s: CompletenessSlotStatus): string {
  return SLOT_STATUS_LABEL[s] ?? s;
}

export function completenessSlotNameLabel(name: string): string {
  return SLOT_NAME_LABEL[name] ?? name;
}

export function mapCompletenessSlot(
  api: CompletenessSlotApi,
): CompletenessSlot {
  return {
    id: api.id,
    tenantId: api.tenantId,
    parentCardType: api.parentCardType,
    parentCardId: api.parentCardId,
    slotName: api.slotName,
    slotKind: api.slotKind,
    status: api.status,
    filledAt: api.filledAt ? new Date(api.filledAt) : null,
    filledByUserId: api.filledByUserId,
    lastProbedAt: api.lastProbedAt ? new Date(api.lastProbedAt) : null,
    probeAttempts: api.probeAttempts,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}
